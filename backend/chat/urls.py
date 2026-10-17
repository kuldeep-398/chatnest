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
    path("admin/conversations/", views.admin_conversations),
    path("admin/conversations/<int:conv_id>/export/", views.export_conversation),
    path("admin/export-all/", views.export_all),
]
