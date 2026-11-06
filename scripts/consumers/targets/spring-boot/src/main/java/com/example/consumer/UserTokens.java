package com.example.consumer;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** The user ids of the credentials' user tokens, which every api's `user` identity double reads. */
final class UserTokens {
    private static final Map<String, String> USER_IDS = Map.of(
            Credentials.text("userToken"), Credentials.text("userId"),
            Credentials.text("throttledUserToken"), Credentials.text("throttledUserId"));

    private UserTokens() {}

    /** The user a bearer token, or else the same token as the session cookie, stands for. */
    static Optional<UUID> userIdOf(Optional<String> bearer, Optional<String> sessionCookie) {
        String token = bearer.or(() -> sessionCookie).orElse("");

        return Optional.ofNullable(USER_IDS.get(token)).map(UUID::fromString);
    }
}
