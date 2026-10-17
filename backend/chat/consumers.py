from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import F
from django.utils import timezone

from .models import Conversation, Message, Presence, are_friends, friends_of
from .services import clean_encrypted_payload, message_dict, reset_presence_once

# Custom close codes. The socket is always accepted first so the browser receives
# these codes (closing before accept() makes the browser see 1006 instead).
CLOSE_AUTH = 4001       # missing/expired token -> client refreshes token and reconnects
CLOSE_FORBIDDEN = 4003  # not a member / not friends -> client stops retrying


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """Per-user socket: presence tracking + unread / new-message / friend-request notifications."""

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.accept()
            await self.close(code=CLOSE_AUTH)
            return
        await database_sync_to_async(reset_presence_once)()
        self.user = user
        self.group = f"user_{user.id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        came_online = await self._change_count(+1)
        if came_online:
            await self._broadcast_presence(True, None)

    async def disconnect(self, code):
        if not hasattr(self, "user"):
            return
        await self.channel_layer.group_discard(self.group, self.channel_name)
        went_offline, last_seen = await self._decrement()
        if went_offline:
            await self._broadcast_presence(False, last_seen)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def notify(self, event):
        await self.send_json(event["payload"])

    @database_sync_to_async
    def _change_count(self, delta):
        p, _ = Presence.objects.get_or_create(user=self.user)
        Presence.objects.filter(pk=p.pk).update(connection_count=F("connection_count") + delta)
        p.refresh_from_db()
        return p.connection_count == 1

    @database_sync_to_async
    def _decrement(self):
        p, _ = Presence.objects.get_or_create(user=self.user)
        now = timezone.now()
        Presence.objects.filter(pk=p.pk, connection_count__gt=0).update(
            connection_count=F("connection_count") - 1, last_seen=now
        )
        p.refresh_from_db()
        return p.connection_count == 0, (p.last_seen or now).isoformat()

    @database_sync_to_async
    def _friend_ids(self):
        return list(friends_of(self.user).values_list("id", flat=True))

    async def _broadcast_presence(self, online, last_seen):
        payload = {"type": "presence", "user_id": self.user.id, "username": self.user.username,
                   "online": online, "last_seen": last_seen}
        for fid in await self._friend_ids():
            await self.channel_layer.group_send(f"user_{fid}", {"type": "notify", "payload": payload})


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """Socket for one conversation: messages, typing, seen receipts."""

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.accept()
            await self.close(code=CLOSE_AUTH)
            return
        self.user = user
        self.conv_id = int(self.scope["url_route"]["kwargs"]["conversation_id"])
        self.other_id = await self._authorize()
        if self.other_id is None:
            await self.accept()
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.group = f"chat_{self.conv_id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.channel_layer.group_send(self.group, {
                "type": "relay", "payload": {"type": "typing", "user_id": self.user.id,
                                             "username": self.user.username, "is_typing": False}})

    async def receive_json(self, content, **kwargs):
        kind = content.get("type")
        if kind == "message":
            payload = clean_encrypted_payload(content)  # plaintext "content" is never accepted
            if payload is None:
                await self.send_json({"type": "error", "detail": "Invalid encrypted message."})
                return
            if not await self._still_friends():
                await self.send_json({"type": "error", "detail": "You are no longer friends."})
                return
            msg, unread = await self._save(*payload)
            await self.channel_layer.group_send(self.group, {
                "type": "relay", "payload": {"type": "message", "message": msg,
                                             "client_id": content.get("client_id")}})
            for uid, extra in ((self.other_id, {"unread": unread}), (self.user.id, {})):
                await self.channel_layer.group_send(f"user_{uid}", {"type": "notify", "payload": {
                    "type": "new_message", "conversation": self.conv_id, "message": msg, **extra}})
        elif kind == "typing":
            await self.channel_layer.group_send(self.group, {
                "type": "relay", "payload": {"type": "typing", "user_id": self.user.id,
                                             "username": self.user.username,
                                             "is_typing": bool(content.get("is_typing"))}})
        elif kind == "seen":
            ids, seen_at = await self._mark_seen()
            if ids:
                await self.channel_layer.group_send(self.group, {
                    "type": "relay", "payload": {"type": "seen", "ids": ids, "seen_at": seen_at,
                                                 "by": self.user.id}})
                # Also tell the sender's per-user socket so their sidebar ticks turn blue
                # even when this chat isn't open on their side.
                await self.channel_layer.group_send(f"user_{self.other_id}", {"type": "notify", "payload": {
                    "type": "seen", "conversation": self.conv_id, "ids": ids, "seen_at": seen_at,
                    "by": self.user.id}})
            await self.channel_layer.group_send(f"user_{self.user.id}", {"type": "notify", "payload": {
                "type": "unread", "conversation": self.conv_id, "unread": 0}})

    async def relay(self, event):
        await self.send_json(event["payload"])

    @database_sync_to_async
    def _authorize(self):
        try:
            conv = Conversation.objects.select_related("user1", "user2").get(id=self.conv_id)
        except Conversation.DoesNotExist:
            return None
        if not conv.has_member(self.user):
            return None
        other = conv.other(self.user)
        return other.id if are_friends(self.user, other) else None

    @database_sync_to_async
    def _still_friends(self):
        from django.contrib.auth import get_user_model
        return are_friends(self.user, get_user_model()(id=self.other_id))

    @database_sync_to_async
    def _save(self, ciphertext, iv):
        m = Message.objects.create(conversation_id=self.conv_id, sender=self.user,
                                   ciphertext=ciphertext, iv=iv)
        m = Message.objects.select_related("sender").get(pk=m.pk)
        unread = Message.objects.filter(conversation_id=self.conv_id, seen_at__isnull=True).exclude(
            sender_id=self.other_id).count()
        return message_dict(m), unread

    @database_sync_to_async
    def _mark_seen(self):
        now = timezone.now()
        qs = Message.objects.filter(conversation_id=self.conv_id, seen_at__isnull=True).exclude(sender=self.user)
        ids = list(qs.values_list("id", flat=True))
        Message.objects.filter(id__in=ids).update(seen_at=now)
        return ids, now.isoformat()
