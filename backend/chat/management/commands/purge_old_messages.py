from django.conf import settings
from django.core.management.base import BaseCommand

from chat.services import purge_old_messages


class Command(BaseCommand):
    help = "Delete messages older than MESSAGE_TTL_HOURS (default 24)."

    def add_arguments(self, parser):
        parser.add_argument("--hours", type=float, default=None)

    def handle(self, *args, hours=None, **opts):
        h = settings.MESSAGE_TTL_HOURS if hours is None else hours
        n = purge_old_messages(h)
        self.stdout.write(self.style.SUCCESS(f"Deleted {n} message(s) older than {h} hour(s)."))
