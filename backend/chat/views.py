import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import Conversation, FriendRequest, Message, Presence, UserKey, are_friends, friends_of
from .serializers import RegisterSerializer, UserSerializer
from .services import b64_len, message_dict, notify_user

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


@api_view(["GET"])
def me(request):
    return Response(UserSerializer(request.user).data)


def _req_dict(r):
    return {"id": r.id, "from_user": r.from_user.username, "to_user": r.to_user.username,
            "status": r.status, "created_at": r.created_at.isoformat()}


@api_view(["GET", "POST"])
def friend_requests(request):
    if request.method == "GET":
        incoming = FriendRequest.objects.filter(to_user=request.user, status=FriendRequest.PENDING)
        outgoing = FriendRequest.objects.filter(from_user=request.user, status=FriendRequest.PENDING)
        return Response({
            "incoming": [_req_dict(r) for r in incoming.select_related("from_user", "to_user")],
            "outgoing": [_req_dict(r) for r in outgoing.select_related("from_user", "to_user")],
        })
    username = (request.data.get("username") or "").strip()
    target = User.objects.filter(username__iexact=username).first()
    if not target:
        return Response({"detail": "No user with that username."}, status=404)
    if target == request.user:
        return Response({"detail": "You can't add yourself."}, status=400)
    if are_friends(request.user, target):
        return Response({"detail": "Already friends."}, status=400)
    reverse = FriendRequest.objects.filter(from_user=target, to_user=request.user,
                                           status=FriendRequest.PENDING).first()
    if reverse:  # they already asked us -> auto-accept
        return _accept(reverse)
    fr, created = FriendRequest.objects.get_or_create(from_user=request.user, to_user=target)
    if not created:
        if fr.status == FriendRequest.PENDING:
            return Response({"detail": "Request already sent."}, status=400)
        fr.status = FriendRequest.PENDING
        fr.save()
    notify_user(target.id, {"type": "friend_request", "from_user": request.user.username})
    return Response(_req_dict(fr), status=201)


def _accept(fr):
    fr.status = FriendRequest.ACCEPTED
    fr.save()
    FriendRequest.objects.filter(from_user=fr.to_user, to_user=fr.from_user).delete()
    conv = Conversation.get_or_create_for(fr.from_user, fr.to_user)
    for u in (fr.from_user, fr.to_user):
        notify_user(u.id, {"type": "friends_changed"})
    return Response({**_req_dict(fr), "conversation": conv.id})


@api_view(["POST"])
def respond_request(request, pk, action):
    fr = get_object_or_404(FriendRequest, pk=pk, to_user=request.user, status=FriendRequest.PENDING)
    if action == "accept":
        return _accept(fr)
    if action == "reject":
        fr.status = FriendRequest.REJECTED
        fr.save()
        return Response(_req_dict(fr))
    raise Http404


@api_view(["GET"])
def friends(request):
    out = []
    for f in friends_of(request.user):
        conv = Conversation.get_or_create_for(request.user, f)
        p = Presence.objects.filter(user=f).first()
        last = conv.messages.order_by("-created_at", "-id").select_related("sender").first()
        unread = conv.messages.filter(seen_at__isnull=True).exclude(sender=request.user).count()
        key = UserKey.objects.filter(user=f).first()
        out.append({
            "id": f.id, "username": f.username, "conversation": conv.id,
            "public_key": key.public_key if key else None,
            "online": bool(p and p.is_online),
            "last_seen": p.last_seen.isoformat() if p and p.last_seen else None,
            "unread": unread, "last_message": message_dict(last) if last else None,
        })
    out.sort(key=lambda x: (x["last_message"] or {}).get("created_at", ""), reverse=True)
    return Response(out)


@api_view(["GET"])
def messages(request, conv_id):
    conv = get_object_or_404(Conversation, pk=conv_id)
    if not conv.has_member(request.user) or not are_friends(request.user, conv.other(request.user)):
        return Response({"detail": "Not allowed."}, status=403)
    return Response([message_dict(m) for m in conv.messages.select_related("sender")])


# ---------- E2EE key bundles ----------

KEY_FIELDS = ("public_key", "wrapped_private_key", "salt", "wrap_iv", "iterations")


def _key_dict(k):
    return {f: getattr(k, f) for f in KEY_FIELDS}


@api_view(["GET", "PUT"])
def my_key(request):
    """GET: my wrapped key bundle (404 if none yet). PUT: upload a new bundle (register,
    first login after the E2EE update, or after an admin password reset)."""
    if request.method == "GET":
        k = UserKey.objects.filter(user=request.user).first()
        return Response(_key_dict(k)) if k else Response({"detail": "No key yet."}, status=404)
    d = request.data
    errors = {}
    try:
        jwk = json.loads(d.get("public_key") or "")
        if not (isinstance(jwk, dict) and jwk.get("kty") == "EC" and jwk.get("crv") == "P-256"
                and "d" not in jwk and jwk.get("x") and jwk.get("y")):
            raise ValueError
    except (ValueError, TypeError):
        errors["public_key"] = "Must be a P-256 public JWK (no private part)."
    for f, lo, hi in (("wrapped_private_key", 32, 2000), ("salt", 16, 64), ("wrap_iv", 12, 12)):
        n = b64_len(d.get(f))
        if n is None or not lo <= n <= hi:
            errors[f] = "Invalid base64 value."
    try:
        iterations = int(d.get("iterations"))
        if not 100_000 <= iterations <= 10_000_000:
            raise ValueError
    except (ValueError, TypeError):
        errors["iterations"] = "Must be between 100000 and 10000000."
    if errors:
        return Response(errors, status=400)
    k, _ = UserKey.objects.update_or_create(user=request.user, defaults={
        "public_key": d["public_key"], "wrapped_private_key": d["wrapped_private_key"],
        "salt": d["salt"], "wrap_iv": d["wrap_iv"], "iterations": iterations})
    for f in friends_of(request.user):  # friends must refetch the new public key
        notify_user(f.id, {"type": "friends_changed"})
    return Response(_key_dict(k))


@api_view(["GET"])
def public_key(request, user_id):
    """Public key of myself or a friend only."""
    other = get_object_or_404(User, pk=user_id)
    if other != request.user and not are_friends(request.user, other):
        return Response({"detail": "Not allowed."}, status=403)
    k = UserKey.objects.filter(user=other).first()
    return Response({"user_id": other.id, "public_key": k.public_key if k else None})


# ---------- admin: aggregate stats only (server can't read messages) ----------

@api_view(["GET"])
@permission_classes([permissions.IsAdminUser])
def admin_stats(request):
    return Response({
        "users": User.objects.count(),
        "users_with_keys": UserKey.objects.count(),
        "conversations": Conversation.objects.count(),
        "messages_last_24h": Message.objects.count(),
        "online": Presence.objects.filter(connection_count__gt=0).count(),
    })


# ---------- SPA (built frontend) ----------

def spa_view(request):
    dist = settings.FRONTEND_DIST.resolve()
    rel = request.path.lstrip("/")
    if rel:
        candidate = (dist / rel).resolve()
        if candidate.is_file() and dist in candidate.parents:
            return FileResponse(open(candidate, "rb"))
    index = dist / "index.html"
    if index.is_file():
        return FileResponse(open(index, "rb"), content_type="text/html")
    return HttpResponse("ChatNest API is running. Build the frontend (cd frontend && npm run build) "
                        "to serve the UI from this URL.", content_type="text/plain")
