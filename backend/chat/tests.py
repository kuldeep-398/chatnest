import io
import zipfile
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

from .models import Conversation, FriendRequest, Message, Presence, are_friends

User = get_user_model()


class Base(TransactionTestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pass12345")
        self.bob = User.objects.create_user("bob", password="pass12345")
        self.carol = User.objects.create_user("carol", password="pass12345")

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

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
    def ws(self, user, path):
        return WebsocketCommunicator(application, f"{path}?token={AccessToken.for_user(user)}")

    def test_non_friends_cannot_chat(self):
        conv = Conversation.get_or_create_for(self.alice, self.carol)

        async def run():
            comm = self.ws(self.alice, f"/ws/chat/{conv.id}/")
            ok, _ = await comm.connect()
            self.assertFalse(ok)
            anon = WebsocketCommunicator(application, f"/ws/chat/{conv.id}/")
            ok, _ = await anon.connect()
            self.assertFalse(ok)
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

            await a.send_json_to({"type": "message", "content": "hello bob"})
            got = await b.receive_json_from()
            self.assertEqual(got["message"]["content"], "hello bob")
            self.assertFalse(got["message"]["seen"])
            await a.receive_json_from()
            note = await bob_n.receive_json_from()
            self.assertEqual((note["type"], note["unread"]), ("new_message", 1))

            await b.send_json_to({"type": "seen"})
            seen = await a.receive_json_from()
            self.assertEqual(seen["type"], "seen")
            self.assertEqual(seen["ids"], [got["message"]["id"]])

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


class PurgeTests(Base):
    def test_purge_deletes_old(self):
        conv = self.befriend(self.alice, self.bob)
        old = Message.objects.create(conversation=conv, sender=self.alice, content="old")
        Message.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=25))
        Message.objects.create(conversation=conv, sender=self.alice, content="new")
        call_command("purge_old_messages", stdout=io.StringIO())
        self.assertEqual(list(Message.objects.values_list("content", flat=True)), ["new"])


class ExportTests(Base):
    def test_export_requires_admin(self):
        conv = self.befriend(self.alice, self.bob)
        Message.objects.create(conversation=conv, sender=self.alice, content="hi there")
        for url in ["/api/admin/conversations/", f"/api/admin/conversations/{conv.id}/export/",
                    "/api/admin/export-all/"]:
            self.assertEqual(self.client_for(self.alice).get(url).status_code, 403)
            self.assertEqual(APIClient().get(url).status_code, 401)
        admin = User.objects.create_user("root", password="x", is_staff=True)
        c = self.client_for(admin)
        r = c.get(f"/api/admin/conversations/{conv.id}/export/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("alice: hi there", r.content.decode())
        self.assertIn("IST", r.content.decode())
        z = zipfile.ZipFile(io.BytesIO(c.get("/api/admin/export-all/").content))
        self.assertEqual(len(z.namelist()), 1)
