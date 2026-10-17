from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def user_from_token(raw):
    try:
        token = AccessToken(raw)
        return get_user_model().objects.get(id=token["user_id"], is_active=True)
    except (TokenError, KeyError, get_user_model().DoesNotExist):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Authenticate WebSocket connections via ?token=<access JWT>."""

    async def __call__(self, scope, receive, send):
        qs = parse_qs(scope.get("query_string", b"").decode())
        token = (qs.get("token") or [None])[0]
        scope["user"] = await user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)
