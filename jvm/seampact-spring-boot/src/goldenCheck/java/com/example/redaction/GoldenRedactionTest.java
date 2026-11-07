package com.example.redaction;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.GetTaskHeaders;
import com.example.tasks.api.PaymentsHeaders;
import com.example.tasks.api.PaymentsInput;
import com.example.tasks.api.UserAuthenticateRequest;
import com.example.tasks.api.UserCredentials;
import com.example.tasks.api.schemas.PaymentEvent;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * The compiled golden records of each kind of redaction the reference contract's operations carry (ADR 0022
 * "Redaction"): a known secret is absent from {@code toString()}, the redaction constant present.
 */
class GoldenRedactionTest {
    private static final String REDACTED = "[redacted]";
    private static final String BEARER_SECRET = "bearer-secret-1";
    private static final String COOKIE_SECRET = "cookie-secret-2";
    private static final String CSRF_SECRET = "csrf-secret-3";
    private static final String SIGNED_BODY_SECRET = "signed-body-secret-4";
    private static final String SIGNATURE_SECRET = "signature-secret-5";

    private static void assertRedacted(Object record, String... secrets) {
        String shown = record.toString();

        for (String secret : secrets) {
            assertFalse(shown.contains(secret), () -> "toString() shows a secret: " + shown);
        }
        assertTrue(shown.contains(REDACTED), () -> "toString() lacks " + REDACTED + ": " + shown);
    }

    private static UserCredentials credentials() {
        return new UserCredentials(Optional.of(BEARER_SECRET), Optional.of(COOKIE_SECRET));
    }

    @Test
    void credentialsRecordHidesEveryMember() {
        assertRedacted(credentials(), BEARER_SECRET, COOKIE_SECRET);
    }

    @Test
    void authenticateRequestHidesCredentialsAndCsrfToken() {
        UserAuthenticateRequest request = new UserAuthenticateRequest(
                credentials(),
                Optional.of(CSRF_SECRET),
                new RequestView("GET", "/v1/channels/1/tasks/2", Map.of(), Optional.empty()),
                new OperationRef("tasks", "getTask"),
                Map.of());

        assertRedacted(request, BEARER_SECRET, COOKIE_SECRET, CSRF_SECRET);
        assertTrue(request.toString().contains("getTask"), request::toString);
    }

    @Test
    void credentialHeaderOfAnOperationInputIsHidden() {
        assertRedacted(new GetTaskHeaders(Optional.of("Bearer " + BEARER_SECRET)), BEARER_SECRET);
    }

    @Test
    void signedRouteInputHidesTheParsedBody() {
        PaymentEvent event = new PaymentEvent(SIGNED_BODY_SECRET, "charge.succeeded", JsonNodeFactory.instance.objectNode().put("note", SIGNED_BODY_SECRET));

        assertRedacted(new PaymentsInput(new PaymentsHeaders("t=1,v1=" + SIGNATURE_SECRET), event, null), SIGNED_BODY_SECRET, SIGNATURE_SECRET);
    }
}
