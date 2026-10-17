import os
import sys

from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "chat"

    def ready(self):
        # Only start the periodic purger when actually serving (daphne / runserver),
        # not during migrate/test/shell. With runserver's autoreloader, only the child runs it.
        argv = " ".join(sys.argv)
        serving = "daphne" in argv or ("runserver" in argv and os.environ.get("RUN_MAIN") == "true")
        if serving and os.getenv("DISABLE_PURGER") != "1":
            from .services import start_background_purger
            start_background_purger()
