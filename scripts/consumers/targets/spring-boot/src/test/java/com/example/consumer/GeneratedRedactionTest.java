package com.example.consumer;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.GetTaskHeaders;
import com.example.tasks.api.PaymentsHeaders;
import com.example.tasks.api.PaymentsInput;
import com.example.tasks.api.StripeAuthenticateRequest;
import com.example.tasks.api.StripeCredentials;
import com.example.tasks.api.UserAuthenticateRequest;
import com.example.tasks.api.UserCredentials;
import com.example.tasks.api.schemas.PaymentEvent;
import com.example.tasksservice.api.ServiceCredentials;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignatureEncoding;
import io.github.jubasse.seampact.hooks.SignatureTemplate;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;

/**
 * The records the plugin generated for this app, one of each kind of redaction (ADR 0022 "Redaction"): a known secret
 * is absent from {@code toString()} and the redaction constant present. The reference contract declares no
 * {@code sensitive} member, so that kind is checked by the generator's golden test only.
 */
class GeneratedRedactionTest {
    private static final String REDACTED = "[redacted]";
    private static final String BEARER_SECRET = "bearer-secret-1";
    private static final String COOKIE_SECRET = "cookie-secret-2";
    private static final String CSRF_SECRET = "csrf-secret-3";
    private static final String SIGNED_BODY_SECRET = "signed-body-secret-4";
    private static final String SIGNATURE_SECRET = "signature-secret-5";
    private static final String SERVICE_TOKEN_SECRET = "service-token-secret-6";

    private static void assertRedacted(Object record, String... secrets) {
        String shown = record.toString();

        for (String secret : secrets) {
            assertFalse(shown.contains(secret), () -> "toString() shows a secret: " + shown);
        }
        assertTrue(shown.contains(REDACTED), () -> "toString() lacks " + REDACTED + ": " + shown);
    }

    private static UserCredentials userCredentials() {
        return new UserCredentials(Optional.of(BEARER_SECRET), Optional.of(COOKIE_SECRET));
    }

    private static RequestView requestView(String path) {
        return new RequestView("POST", path, Map.of(), Optional.empty());
    }

    @Test
    void credentialsRecordsHideEveryMember() {
        assertRedacted(userCredentials(), BEARER_SECRET, COOKIE_SECRET);
        assertRedacted(new ServiceCredentials(Optional.of(SERVICE_TOKEN_SECRET)), SERVICE_TOKEN_SECRET);
    }

    @Test
    void authenticateRequestHidesCredentialsAndCsrfToken() {
        UserAuthenticateRequest request = new UserAuthenticateRequest(
                userCredentials(),
                Optional.of(CSRF_SECRET),
                requestView("/v1/channels/1/tasks"),
                new OperationRef("tasks", "createTask"),
                Map.of());

        assertRedacted(request, BEARER_SECRET, COOKIE_SECRET, CSRF_SECRET);
    }

    @Test
    void signedAuthenticateRequestHidesTheBodyAndTheSignature() {
        SignatureTemplate template = new SignatureTemplate(
                "hmac-sha256", "{ts}.{body}", SignatureEncoding.HEX, Optional.empty());
        SignedTemplateRequest signed = new SignedTemplateRequest(
                SIGNED_BODY_SECRET.getBytes(StandardCharsets.UTF_8),
                Optional.of("1"),
                List.of(SIGNATURE_SECRET),
                "stripe",
                template);
        StripeAuthenticateRequest request = new StripeAuthenticateRequest(
                new StripeCredentials(),
                Optional.empty(),
                Optional.of(signed),
                requestView("/v1/payments"),
                new OperationRef("tasks", "payments"),
                Map.of());

        assertRedacted(request, SIGNED_BODY_SECRET, SIGNATURE_SECRET);
    }

    @Test
    void credentialAndSignatureHeadersOfAnOperationInputAreHidden() {
        assertRedacted(new GetTaskHeaders(Optional.of("Bearer " + BEARER_SECRET)), BEARER_SECRET);
        assertRedacted(new PaymentsHeaders("t=1,v1=" + SIGNATURE_SECRET), SIGNATURE_SECRET);
    }

    @Test
    void signedRouteInputHidesTheParsedBody() {
        PaymentEvent event = new PaymentEvent(SIGNED_BODY_SECRET, "charge.succeeded", JsonNodeFactory.instance.objectNode().put("note", SIGNED_BODY_SECRET));

        assertRedacted(new PaymentsInput(new PaymentsHeaders("t=1,v1=" + SIGNATURE_SECRET), event), SIGNED_BODY_SECRET, SIGNATURE_SECRET);
    }
}
