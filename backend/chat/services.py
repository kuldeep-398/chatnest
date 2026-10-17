"""Shared helpers: purge, serialization, E2EE payload validation, channel-layer notifications."""
import base64
import binascii
import logging
import threading
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone

from .models import Message

log = logging.getLogger("chatnest")


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
        "ciphertext": m.ciphertext,
        "iv": m.iv,
        "created_at": m.created_at.isoformat(),
        "seen": m.seen_at is not None,
        "seen_at": m.seen_at.isoformat() if m.seen_at else None,
    }


MAX_CIPHERTEXT_B64 = 24000  # ~4000 chars of UTF-8 text + 16-byte GCM tag, base64-encoded


def b64_len(value):
    """Decoded length of a strict base64 string, or None if it isn't valid base64."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return len(base64.b64decode(value, validate=True))
    except (binascii.Error, ValueError):
        return None


def clean_encrypted_payload(content):
    """Return (ciphertext, iv) if the client sent a well-formed encrypted message, else None.
    The server can't read the message; it only checks the shape (12-byte IV, >=16-byte ciphertext)."""
    ct, iv = content.get("ciphertext"), content.get("iv")
    if b64_len(iv) != 12:
        return None
    n = b64_len(ct)
    if n is None or n < 16 or len(ct) > MAX_CIPHERTEXT_B64:
        return None
    return ct, iv


def notify_user(user_id, payload):
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(f"user_{user_id}", {"type": "notify", "payload": payload})


_presence_reset_done = False
_presence_lock = __import__("threading").Lock()


def reset_presence_once():
    """Reset every user's connection count to 0 (offline) once per server process.

    After a crash, counts are left > 0 and users look 'online' forever. Run lazily on the
    first socket connect (not in AppConfig.ready, so migrate/tests/shell never touch the DB
    at import time). last_seen is preserved. If the DB isn't ready, retry on the next connect.
    """
    global _presence_reset_done
    if _presence_reset_done:
        return
    with _presence_lock:
        if _presence_reset_done:
            return
        from django.db import DatabaseError
        from .models import Presence
        try:
            Presence.objects.filter(connection_count__gt=0).update(connection_count=0)
        except DatabaseError:
            return
        _presence_reset_done = True
