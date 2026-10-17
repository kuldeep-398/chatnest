from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

urlpatterns = [
    path("auth/register/", views.RegisterView.as_view()),
    path("auth/login/", TokenObtainPairView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", views.me),
    path("friends/", views.friends),
    path("friend-requests/", views.friend_requests),
    path("friend-requests/<int:pk>/<str:action>/", views.respond_request),
    path("conversations/<int:conv_id>/messages/", views.messages),
    path("keys/me/", views.my_key),
    path("keys/<int:user_id>/", views.public_key),
    # Server-side plaintext export was removed (E2EE). Export now happens in the browser.
    path("admin/stats/", views.admin_stats),
]
