from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from chat.views import spa_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("chat.urls")),
    # Serve built React app (frontend/dist) for single-URL tunnel deployments.
    re_path(r"^(?!api/|admin/|ws/|static/).*$", spa_view),
]
