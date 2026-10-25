package io.github.jubasse.seampact.webhooks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

// The scheme refuses at construction what grammar section 09 refuses in a contract, so a scheme built by hand never
// signs less than the raw body once.
class SignatureSchemeTest {
    private static final Optional<Duration> FIVE_MINUTES = Optional.of(Duration.ofMinutes(5));
    private static final int KEY_ID_MESSAGE_LIMIT = 64;

    @ParameterizedTest
    @ValueSource(strings = {"{ts}.", "{ts}.{rawBody}.{rawBody}", "{ts}.{rawBody}.{ts}"})
    void refusesAPayloadWithoutTheRawBodyOnceOrWithTheTimestampTwice(String payload) {
        IllegalArgumentException refused = assertThrows(
            IllegalArgumentException.class,
            () -> new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, payload, SignatureEncoding.HEX, FIVE_MINUTES)
        );

        assertTrue(refused.getMessage().contains("'" + payload + "'"), refused.getMessage());
    }

    @Test
    void refusesAToleranceWithoutATimestamp() {
        IllegalArgumentException refused = assertThrows(
            IllegalArgumentException.class,
            () -> new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX, FIVE_MINUTES)
        );

        assertTrue(refused.getMessage().contains("tolerance"), refused.getMessage());
    }

    @Test
    void refusesANegativeTolerance() {
        IllegalArgumentException refused = assertThrows(
            IllegalArgumentException.class,
            () -> new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, "{ts}.{rawBody}", SignatureEncoding.HEX, Optional.of(Duration.ofSeconds(-1)))
        );

        assertTrue(refused.getMessage().contains("negative"), refused.getMessage());
    }

    @Test
    void aLookupReturningNullIsRefusedNamingTheLookup() {
        TemplateSignatureVerifier verifier = new TemplateSignatureVerifier(keyId -> null);
        SignatureScheme scheme = new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX);

        NullPointerException refused = assertThrows(
            NullPointerException.class,
            () -> verifier.verify(new byte[0], Optional.empty(), List.of("00"), "test", scheme)
        );

        assertTrue(refused.getMessage().contains("SecretLookup"), refused.getMessage());
    }

    @Test
    void theRequestsKeyIdEntersTheEmptySecretMessageBoundedAndWithoutControlCharacters() {
        String hostileKeyId = "\u001b[2J" + "k".repeat(10_000) + "\r\nforged";

        String message = new EmptySignatureSecretException(hostileKeyId, 0).getMessage();

        assertFalse(message.chars().anyMatch(Character::isISOControl), message);
        assertFalse(message.contains("k".repeat(KEY_ID_MESSAGE_LIMIT + 1)), "the key id is not bounded");
        assertEquals(1, message.split("position 0", -1).length - 1);
    }
}
