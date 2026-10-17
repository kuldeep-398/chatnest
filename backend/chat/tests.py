import base64
import io
import json
import os
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from config.asgi import application

from .models import Conversation, FriendRequest, Message, Presence, UserKey, are_friends

User = get_user_model()


def b64(n):
    return base64.b64encode(os.urandom(n)).decode()


def enc(n=40):
    """A fake encrypted payload (the server can't tell it from a real one)."""
    return {"ciphertext": b64(n), "iv": b64(12)}


def key_bundle(**over):
    jwk = {"kty": "EC", "crv": "P-256", "x": "x" * 43, "y": "y" * 43, "ext": True}
    return {"public_key": json.dumps(jwk), "wrapped_private_key": b64(150), "salt": b64(16),
            "wrap_iv": b64(12), "iterations": 600000, **over}


class Base(TransactionTestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pass12345")
        self.bob = User.objects.create_user("bob", password="pass12345")
        self.carol = User.objects.create_user("carol", password="pass12345")

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def ws(self, user, path):
        return WebsocketCommunicator(application, f"{path}?token={AccessToken.for_user(user)}")

    def befriend(self, a, b):
        FriendRequest.objects.create(from_user=a, to_user=b, status=FriendRequest.ACCEPTED)
        return Conversation.get_or_create_for(a, b)


class AuthTests(Base):
    def test_register_login_unique(self):
        c = APIClient()
        self.assertEqual(c.post("/api/auth/register/", {"username": "dave", "password": "secret123"}).status_code, 201)
        self.assertEqual(c.post("/api/auth/register/", {"username": "Dave", "password": "secret123"}).status_code, 400)
        r = c.post("/api/auth/login/", {"username": "dave", "password": "secret123"})
        self.assertIn("access", r.data)


class FriendFlowTests(Base):
    def test_send_accept_reject(self):
        a, b, c = self.client_for(self.alice), self.client_for(self.bob), self.client_for(self.carol)
        r = a.post("/api/friend-requests/", {"username": "bob"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(a.post("/api/friend-requests/", {"username": "bob"}).status_code, 400)
        self.assertEqual(a.post("/api/friend-requests/", {"username": "nobody"}).status_code, 404)
        inc = b.get("/api/friend-requests/").data["incoming"]
        self.assertEqual(len(inc), 1)
        self.assertEqual(a.get("/api/friend-requests/").data["outgoing"][0]["to_user"], "bob")
        self.assertEqual(c.post(f"/api/friend-requests/{inc[0]['id']}/accept/").status_code, 404)  # not recipient
        r = b.post(f"/api/friend-requests/{inc[0]['id']}/accept/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(are_friends(self.alice, self.bob))
        self.assertEqual([f["username"] for f in a.get("/api/friends/").data], ["bob"])
        rid = c.post("/api/friend-requests/", {"username": "alice"}).data["id"]
        a.post(f"/api/friend-requests/{rid}/reject/")
        self.assertFalse(are_friends(self.alice, self.carol))


class ChannelsTests(Base):

    def test_non_friends_cannot_chat(self):
        conv = Conversation.get_or_create_for(self.alice, self.carol)

        async def run():
            # Accepted first, then closed with a custom code the browser can see.
            comm = self.ws(self.alice, f"/ws/chat/{conv.id}/")
            ok, _ = await comm.connect()
            self.assertTrue(ok)
            self.assertEqual(await comm.receive_output(), {"type": "websocket.close", "code": 4003})
            anon = WebsocketCommunicator(application, f"/ws/chat/{conv.id}/")
            ok, _ = await anon.connect()
            self.assertTrue(ok)
            self.assertEqual(await anon.receive_output(), {"type": "websocket.close", "code": 4001})
            bad = WebsocketCommunicator(application, "/ws/notifications/?token=garbage")
            ok, _ = await bad.connect()
            self.assertTrue(ok)
            self.assertEqual(await bad.receive_output(), {"type": "websocket.close", "code": 4001})
        async_to_sync(run)()
        self.assertEqual(self.client_for(self.alice).get(f"/api/conversations/{conv.id}/messages/").status_code, 403)

    def test_message_send_seen_and_presence(self):
        conv = self.befriend(self.alice, self.bob)

        async def run():
            bob_n = self.ws(self.bob, "/ws/notifications/")
            self.assertTrue((await bob_n.connect())[0])
            alice_n = self.ws(self.alice, "/ws/notifications/")
            self.assertTrue((await alice_n.connect())[0])
            pres = await bob_n.receive_json_from()
            self.assertEqual((pres["type"], pres["username"], pres["online"]), ("presence", "alice", True))

            a = self.ws(self.alice, f"/ws/chat/{conv.id}/")
            b = self.ws(self.bob, f"/ws/chat/{conv.id}/")
            self.assertTrue((await a.connect())[0])
            self.assertTrue((await b.connect())[0])

            await a.send_json_to({"type": "typing", "is_typing": True})
            t = await b.receive_json_from()
            self.assertEqual((t["type"], t["is_typing"]), ("typing", True))
            await a.receive_json_from()

            # Plaintext is rejected outright.
            await a.send_json_to({"type": "message", "content": "hello bob"})
            self.assertEqual((await a.receive_json_from())["type"], "error")
            payload = enc()
            await a.send_json_to({"type": "message", **payload})
            got = await b.receive_json_from()
            self.assertEqual((got["message"]["ciphertext"], got["message"]["iv"]), (payload["ciphertext"], payload["iv"]))
            self.assertNotIn("content", got["message"])
            self.assertFalse(got["message"]["seen"])
            await a.receive_json_from()
            note = await bob_n.receive_json_from()
            self.assertEqual((note["type"], note["unread"]), ("new_message", 1))

            await b.send_json_to({"type": "seen"})
            seen = await a.receive_json_from()
            self.assertEqual(seen["type"], "seen")
            self.assertEqual(seen["ids"], [got["message"]["id"]])
            # Sender's per-user socket also gets the seen event (live sidebar ticks).
            ev = await alice_n.receive_json_from()
            while ev["type"] != "seen":
                ev = await alice_n.receive_json_from()
            self.assertEqual((ev["conversation"], ev["ids"], ev["by"]), (conv.id, [got["message"]["id"]], self.bob.id))

            for c in (a, b, alice_n):
                await c.disconnect()
            off = await bob_n.receive_json_from()
            while off["type"] != "presence":
                off = await bob_n.receive_json_from()
            self.assertFalse(off["online"])
            await bob_n.disconnect()
        async_to_sync(run)()
        m = Message.objects.get()
        self.assertEqual(m.sender, self.alice)
        self.assertIsNotNone(m.seen_at)
        self.assertEqual(Presence.objects.get(user=self.alice).connection_count, 0)
        self.assertIsNotNone(Presence.objects.get(user=self.alice).last_seen)


class PresenceResetTests(Base):
    def test_stale_online_reset_on_first_connect(self):
        from . import services
        seen = timezone.now() - timedelta(hours=1)
        Presence.objects.create(user=self.alice, connection_count=3, last_seen=seen)
        Presence.objects.create(user=self.carol, connection_count=2, last_seen=seen)
        services._presence_reset_done = False

        async def run():
            c = self.ws(self.bob, "/ws/notifications/")
            self.assertTrue((await c.connect())[0])
            await c.disconnect()
        async_to_sync(run)()
        self.assertTrue(services._presence_reset_done)
        for u in (self.alice, self.carol):
            p = Presence.objects.get(user=u)
            self.assertEqual(p.connection_count, 0)
            self.assertEqual(p.last_seen, seen)  # last_seen kept
        # Runs only once per process: a later stale count isn't wiped by new connects.
        Presence.objects.filter(user=self.alice).update(connection_count=1)
        services.reset_presence_once()
        self.assertEqual(Presence.objects.get(user=self.alice).connection_count, 1)


class PurgeTests(Base):
    def test_purge_deletes_old(self):
        conv = self.befriend(self.alice, self.bob)
        old = Message.objects.create(conversation=conv, sender=self.alice, **enc())
        Message.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=25))
        new = Message.objects.create(conversation=conv, sender=self.alice, **enc())
        call_command("purge_old_messages", stdout=io.StringIO())
        self.assertEqual(list(Message.objects.values_list("id", flat=True)), [new.id])


class E2EETests(Base):
    def test_server_never_stores_plaintext(self):
        conv = self.befriend(self.alice, self.bob)
        secret = "top secret plaintext 12345"

        async def run():
            a = self.ws(self.alice, f"/ws/chat/{conv.id}/")
            self.assertTrue((await a.connect())[0])
            # Bad shapes are rejected: plaintext, wrong IV length, non-base64, tiny ciphertext.
            for bad in ({"content": secret}, {"ciphertext": b64(40), "iv": b64(8)},
                        {"ciphertext": secret, "iv": b64(12)}, {"ciphertext": b64(4), "iv": b64(12)},
                        {"ciphertext": "!!" * 20, "iv": b64(12)}):
                await a.send_json_to({"type": "message", **bad})
                self.assertEqual((await a.receive_json_from())["type"], "error")
            await a.send_json_to({"type": "message", "content": secret, **enc()})  # extra field ignored
            ok = await a.receive_json_from()
            self.assertEqual(ok["type"], "message")
            await a.disconnect()
        async_to_sync(run)()
        self.assertEqual(Message.objects.count(), 1)
        self.assertFalse([f.name for f in Message._meta.get_fields() if f.name == "content"])
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("SELECT * FROM chat_message")
            dump = repr(cur.fetchall())
        self.assertNotIn(secret, dump)
        r = self.client_for(self.bob).get(f"/api/conversations/{conv.id}/messages/")
        self.assertEqual(set(r.data[0]) >= {"ciphertext", "iv"}, True)
        self.assertNotIn("content", r.data[0])

    def test_keys_endpoint_auth_and_validation(self):
        self.befriend(self.alice, self.bob)
        self.assertEqual(APIClient().get("/api/keys/me/").status_code, 401)
        self.assertEqual(APIClient().put("/api/keys/me/", key_bundle(), format="json").status_code, 401)
        a = self.client_for(self.alice)
        self.assertEqual(a.get("/api/keys/me/").status_code, 404)
        # Private key material in the public JWK is refused; bad base64 / iterations too.
        leaky = json.dumps({"kty": "EC", "crv": "P-256", "x": "x", "y": "y", "d": "secret"})
        for bad in (key_bundle(public_key=leaky), key_bundle(wrap_iv=b64(8)),
                    key_bundle(salt="not base64!"), key_bundle(iterations=1000)):
            self.assertEqual(a.put("/api/keys/me/", bad, format="json").status_code, 400)
        bundle = key_bundle()
        self.assertEqual(a.put("/api/keys/me/", bundle, format="json").status_code, 200)
        self.assertEqual(a.get("/api/keys/me/").data["wrapped_private_key"], bundle["wrapped_private_key"])
        self.assertEqual(UserKey.objects.count(), 1)
        # Friends can read the public key (via endpoint and friends list); strangers can't.
        b = self.client_for(self.bob)
        self.assertEqual(b.get(f"/api/keys/{self.alice.id}/").data["public_key"], bundle["public_key"])
        self.assertEqual(b.get("/api/friends/").data[0]["public_key"], bundle["public_key"])
        self.assertNotIn("wrapped_private_key", b.get(f"/api/keys/{self.alice.id}/").data)
        self.assertEqual(self.client_for(self.carol).get(f"/api/keys/{self.alice.id}/").status_code, 403)
        self.assertEqual(APIClient().get(f"/api/keys/{self.alice.id}/").status_code, 401)
        # Re-upload (e.g. after admin password reset) replaces, doesn't duplicate.
        self.assertEqual(a.put("/api/keys/me/", key_bundle(), format="json").status_code, 200)
        self.assertEqual(UserKey.objects.count(), 1)


class ExportRemovedTests(Base):
    def test_plaintext_export_endpoints_gone(self):
        conv = self.befriend(self.alice, self.bob)
        Message.objects.create(conversation=conv, sender=self.alice, **enc())
        admin = User.objects.create_user("root", password="x", is_staff=True)
        for url in ["/api/admin/conversations/", f"/api/admin/conversations/{conv.id}/export/",
                    "/api/admin/export-all/"]:
            for c in (self.client_for(admin), self.client_for(self.alice), APIClient()):
                self.assertEqual(c.get(url).status_code, 404)

    def test_admin_stats_only(self):
        self.befriend(self.alice, self.bob)
        self.assertEqual(self.client_for(self.alice).get("/api/admin/stats/").status_code, 403)
        self.assertEqual(APIClient().get("/api/admin/stats/").status_code, 401)
        admin = User.objects.create_user("root", password="x", is_staff=True)
        r = self.client_for(admin).get("/api/admin/stats/")
        self.assertEqual((r.status_code, r.data["users"], r.data["conversations"]), (200, 4, 1))
