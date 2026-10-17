from django.conf import settings
from django.db import migrations, models


def delete_plaintext_messages(apps, schema_editor):
    # Old messages were stored in plaintext. Chats expire after 24h anyway, so drop them.
    apps.get_model("chat", "Message").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("chat", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(delete_plaintext_messages, migrations.RunPython.noop),
        migrations.RemoveField(model_name="message", name="content"),
        migrations.AddField(model_name="message", name="ciphertext",
                            field=models.TextField(default=""), preserve_default=False),
        migrations.AddField(model_name="message", name="iv",
                            field=models.CharField(default="", max_length=32), preserve_default=False),
        migrations.CreateModel(
            name="UserKey",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("public_key", models.TextField()),
                ("wrapped_private_key", models.TextField()),
                ("salt", models.CharField(max_length=64)),
                ("wrap_iv", models.CharField(max_length=32)),
                ("iterations", models.PositiveIntegerField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=models.deletion.CASCADE, related_name="e2ee_key",
                                              to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
