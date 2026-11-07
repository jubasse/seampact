package com.example.consumer;

import com.example.tasks.api.StripeAuthenticateHook;
import com.example.tasks.api.StripeAuthenticateRequest;
import com.example.tasks.api.schemas.WebhookCaller;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.SignatureEncoding;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * The `stripe` identity: the signed request verified as `@seampact/signed-webhooks` verifies it on the Node targets,
 * an HMAC-SHA256 over the payload template, compared in constant time, with the timestamp within the tolerance.
 */
@Component
final class StripeHook implements StripeAuthenticateHook {
    private static final String API = "tasks";
    private static final String KEY_ID = "stripe";
    private static final String ACCOUNT = "acct_seampact";
    private static final String HMAC = "HmacSHA256";
    private static final String RAW_BODY_PLACEHOLDER = "{rawBody}";
    private static final String TIMESTAMP_PLACEHOLDER = "{ts}";
    private static final long MILLISECONDS_PER_SECOND = 1000;

    @Override
    public AuthenticateResult<WebhookCaller, Denial> authenticate(StripeAuthenticateRequest request) {
        SuiteControl.recordHookCall("authenticate:stripe", API, request.operation().id());

        boolean verified = request.signature().map(StripeHook::verified).orElse(false);

        return verified
                ? new AuthenticateResult.Authenticated<>(new WebhookCaller(ACCOUNT))
                : new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"));
    }

    private static boolean verified(SignedTemplateRequest signed) {
        if (!KEY_ID.equals(signed.keyId())) return false;

        byte[] expected = hmac(Credentials.text("stripeSecret"), payload(signed));
        boolean anyMatches = signed.candidateSignatures().stream()
                .anyMatch(candidate -> MessageDigest.isEqual(expected, decoded(candidate, signed.template().encoding())));

        return anyMatches && withinTolerance(signed);
    }

    private static byte[] payload(SignedTemplateRequest signed) {
        String timestamp = signed.timestamp().orElse("");
        String[] around = signed.template().payload().split(java.util.regex.Pattern.quote(RAW_BODY_PLACEHOLDER), 2);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.writeBytes(around[0].replace(TIMESTAMP_PLACEHOLDER, timestamp).getBytes(StandardCharsets.UTF_8));
        bytes.writeBytes(signed.rawBody());
        if (around.length > 1) bytes.writeBytes(around[1].replace(TIMESTAMP_PLACEHOLDER, timestamp).getBytes(StandardCharsets.UTF_8));

        return bytes.toByteArray();
    }

    private static byte[] hmac(String secret, byte[] payload) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC));
            return mac.doFinal(payload);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("computing the HMAC-SHA256 of the signed payload failed", failure);
        }
    }

    // A candidate that does not decode in the declared encoding never matches.
    private static byte[] decoded(String candidate, SignatureEncoding encoding) {
        try {
            return encoding == SignatureEncoding.HEX ? HexFormat.of().parseHex(candidate) : Base64.getDecoder().decode(candidate);
        } catch (IllegalArgumentException notEncoded) {
            return new byte[0];
        }
    }

    private static boolean withinTolerance(SignedTemplateRequest signed) {
        if (signed.template().toleranceMs().isEmpty()) return true;
        if (signed.timestamp().isEmpty()) return false;

        long signedAtMs = Long.parseLong(signed.timestamp().get()) * MILLISECONDS_PER_SECOND;

        return Math.abs(System.currentTimeMillis() - signedAtMs) <= signed.template().toleranceMs().get();
    }
}
