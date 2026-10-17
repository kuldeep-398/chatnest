from django.contrib import admin

from .models import Conversation, FriendRequest, Message, Presence, UserKey

admin.site.register(FriendRequest)
admin.site.register(Conversation)
admin.site.register(Message)
admin.site.register(Presence)
admin.site.register(UserKey)
