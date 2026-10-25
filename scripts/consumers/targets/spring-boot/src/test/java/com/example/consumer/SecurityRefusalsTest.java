package com.example.consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Spring Security's refusals in the api's format (ADR 0022 "The consumer and the proof"): its 401, 403 and CSRF
 * refusal reach the client as the operation's {@code api.unauthenticated}, {@code api.forbidden} and
 * {@code api.csrf_invalid} errors, and the generated customizer lets a public route through a chain that requires
 * authentication everywhere else. The reference contract declares no optional-auth operation and no public template
 * beside a literal route, so those matchers are checked by the generator's {@code SecurityMatchersTest}, which runs
 * them in a Spring Security chain on routes of every access kind.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(SuiteSecurity.SECURITY_REFUSALS_PROFILE)
class SecurityRefusalsTest {
    private static final String CHANNEL = "/v1/channels/0b8f3a52-6f0e-4c39-9a51-0d7b7c1d2e3f";
    private static final String CSRF_TOKEN = "suite-csrf-token";
    private static final String JSON = "application/json";

    private final HttpClient client = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int port;

    @Test
    void anUnauthenticatedRequestIsTheOperationsUnauthenticatedError() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri(CHANNEL)).GET());

        assertContractError(response, 401, "api.unauthenticated");
    }

    @Test
    void aCallerWithoutTheRoleIsTheOperationsForbiddenError() throws Exception {
        HttpResponse<String> response = send(createTask(SuiteSecurity.VISITOR).header("Cookie", "XSRF-TOKEN=" + CSRF_TOKEN).header("X-XSRF-TOKEN", CSRF_TOKEN));

        assertContractError(response, 403, "api.forbidden");
    }

    @Test
    void aWriteWithoutTheCsrfTokenIsTheOperationsCsrfError() throws Exception {
        HttpResponse<String> response = send(createTask(SuiteSecurity.MEMBER));

        assertContractError(response, 403, "api.csrf_invalid");
    }

    @Test
    void theCustomizerLetsAPublicRouteThroughAChainThatRequiresAuthentication() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/v1/health")).GET());

        assertEquals(200, response.statusCode(), response.body());
    }

    private HttpRequest.Builder createTask(String user) {
        String basic = Base64.getEncoder().encodeToString((user + ":" + SuiteSecurity.PASSWORD).getBytes(StandardCharsets.UTF_8));

        return HttpRequest.newBuilder(uri(CHANNEL + "/tasks"))
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", JSON)
                .POST(HttpRequest.BodyPublishers.ofString("{}"));
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private HttpResponse<String> send(HttpRequest.Builder request) throws IOException, InterruptedException {
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void assertContractError(HttpResponse<String> response, int status, String code) {
        assertEquals(status, response.statusCode(), response.body());
        assertTrue(response.headers().firstValue("Content-Type").orElse("").contains("json"), response.headers().map().toString());
        assertTrue(response.body().contains("\"code\":\"" + code + "\""), response.body());
    }
}
