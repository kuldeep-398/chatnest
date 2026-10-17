"""Shared helpers: purge, serialization, export, channel-layer notifications."""
import io
import logging
import threading
import zipfile
from datetime import timedelta
from zoneinfo import ZoneInfo

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone

from .models import Conversation, Message

log = logging.getLogger("chatnest")
IST = ZoneInfo("Asia/Kolkata")


def purge_old_messages(hours=None):
    hours = settings.MESSAGE_TTL_HOURS if hours is None else hours
    cutoff = timezone.now() - timedelta(hours=hours)
    deleted, _ = Message.objects.filter(created_at__lt=cutoff).delete()
    return deleted


_purger_started = False
_purger_lock = threading.Lock()


def start_background_purger():
    """Purge on startup and every PURGE_INTERVAL_SECONDS. Guarded against double start."""
    global _purger_started
    with _purger_lock:
        if _purger_started:
            return
        _purger_started = True

    stop = threading.Event()

    def loop():
        from django.db import close_old_connections
        while True:
            try:
                close_old_connections()
                n = purge_old_messages()
                if n:
                    log.info("ChatNest purge: deleted %s old messages", n)
            except Exception:  # DB may not be migrated yet
                log.exception("ChatNest purge failed")
            if stop.wait(settings.PURGE_INTERVAL_SECONDS):
                return

    threading.Thread(target=loop, name="chatnest-purger", daemon=True).start()


def message_dict(m):
    return {
        "id": m.id,
        "conversation": m.conversation_id,
        "sender": m.sender.username,
        "sender_id": m.sender_id,
        "content": m.content,
        "created_at": m.created_at.isoformat(),
        "seen": m.seen_at is not None,
        "seen_at": m.seen_at.isoformat() if m.seen_at else None,
    }


def notify_user(user_id, payload):
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(f"user_{user_id}", {"type": "notify", "payload": payload})


def conversation_txt(conv: Conversation) -> str:
    lines = [
        f"ChatNest conversation #{conv.id}: {conv.user1.username} <-> {conv.user2.username}",
        f"Exported: {timezone.now().astimezone(IST):%Y-%m-%d %H:%M:%S} IST",
        "=" * 60,
    ]
    for m in conv.messages.select_related("sender"):
        ts = m.created_at.astimezone(IST).strftime("%Y-%m-%d %H:%M:%S")
        tick = " [seen]" if m.seen_at else ""
        lines.append(f"[{ts} IST] {m.sender.username}: {m.content}{tick}")
    if len(lines) == 3:
        lines.append("(no messages)")
    return "\n".join(lines) + "\n"


def conversation_filename(conv):
    return f"chat_{conv.id}_{conv.user1.username}_{conv.user2.username}.txt"


def all_conversations_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for conv in Conversation.objects.select_related("user1", "user2"):
            zf.writestr(conversation_filename(conv), conversation_txt(conv))
    return buf.getvalue()
