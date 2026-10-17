from django.conf import settings
from django.db import models
from django.db.models import Q

User = settings.AUTH_USER_MODEL


class FriendRequest(models.Model):
    PENDING, ACCEPTED, REJECTED = "pending", "accepted", "rejected"
    STATUS_CHOICES = [(PENDING, "Pending"), (ACCEPTED, "Accepted"), (REJECTED, "Rejected")]
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sent_requests")
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="received_requests")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("from_user", "to_user")


class Conversation(models.Model):
    """1-to-1 conversation; user1.id < user2.id always."""
    user1 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    user2 = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user1", "user2")

    @classmethod
    def get_or_create_for(cls, a, b):
        u1, u2 = (a, b) if a.id < b.id else (b, a)
        return cls.objects.get_or_create(user1=u1, user2=u2)[0]

    @classmethod
    def for_user(cls, user):
        return cls.objects.filter(Q(user1=user) | Q(user2=user))

    def has_member(self, user):
        return user.id in (self.user1_id, self.user2_id)

    def other(self, user):
        return self.user2 if user.id == self.user1_id else self.user1


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="messages")
    content = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]


class Presence(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="presence")
    connection_count = models.PositiveIntegerField(default=0)
    last_seen = models.DateTimeField(null=True, blank=True)

    @property
    def is_online(self):
        return self.connection_count > 0


def are_friends(a, b):
    return FriendRequest.objects.filter(
        Q(from_user=a, to_user=b) | Q(from_user=b, to_user=a), status=FriendRequest.ACCEPTED
    ).exists()


def friends_of(user):
    from django.contrib.auth import get_user_model
    reqs = FriendRequest.objects.filter(Q(from_user=user) | Q(to_user=user), status=FriendRequest.ACCEPTED)
    ids = {r.to_user_id if r.from_user_id == user.id else r.from_user_id for r in reqs}
    return get_user_model().objects.filter(id__in=ids)
