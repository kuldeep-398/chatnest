from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ["id", "username", "password"]

    def validate_username(self, v):
        if User.objects.filter(username__iexact=v).exists():
            raise serializers.ValidationError("Username already taken.")
        return v

    def validate_password(self, v):
        validate_password(v)
        return v

    def create(self, data):
        return User.objects.create_user(username=data["username"], password=data["password"])


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "is_staff"]
