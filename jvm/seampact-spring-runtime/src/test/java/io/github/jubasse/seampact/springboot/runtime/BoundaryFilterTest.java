package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.FilterChain;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Step 1 (ADR 0022 "Placement"): the raw-path match, the api's 404, the bounded body and the 500 for an escaped exception. */
class BoundaryFilterTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String TABLE = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "errors": {
               "api.not_found": {"code": "api.not_found", "family": "api", "nature": "refused", "http": {"status": 404}, "default": "notFound"},
               "api.too_large": {"code": "api.too_large", "family": "api", "nature": "refused", "http": {"status": 413}, "default": "payloadTooLarge"},
               "api.media": {"code": "api.media", "family": "api", "nature": "refused", "http": {"status": 415}, "default": "unsupportedMediaType"},
               "api.invalid": {"code": "api.invalid", "family": "api", "nature": "refused", "http": {"status": 400}, "default": "schemaInvalid"},
               "api.internal": {"code": "api.internal", "family": "api", "nature": "failed", "http": {"status": 500}, "default": "undeclaredStatus"}},
             "formats": {"bare": {"error": {"media": "application/json", "headers": [], "body": {"kind": "object",
               "members": [{"name": {"kind": "text", "text": "code"}, "value": {"kind": "slot", "slot": "code", "path": []}}]}}}},
             "operations": [
               {"id": "createTask", "method": "post", "path": "/v1/tasks", "surface": "app", "safe": false, "format": "bare",
                "input": {"media": "application/json", "bodyLimitBytes": 20},
                "responses": [{"status": 200}],
                "errors": [{"code": "api.not_found"}, {"code": "api.too_large"}, {"code": "api.media"}, {"code": "api.invalid"}, {"code": "api.internal"}]}],
             "settings": %SETTINGS%}
            """;

    @Test
    void aPathOutsideTheApisBasePathsIsLeftToTheApp() throws Exception {
        Run run = new Run("{}");

        run.send(new MockHttpServletRequest("GET", "/other"));

        assertTrue(run.chainCalled);
        assertEquals(200, run.servletResponse.getStatus());
    }

    @Test
    void aPathUnderTheBasePathNoRouteServesIsTheApisNotFound() throws Exception {
        Run run = new Run("{}");

        run.send(new MockHttpServletRequest("GET", "/v1/nothing"));

        assertFalse(run.chainCalled);
        assertEquals(404, run.servletResponse.getStatus());
        assertEquals("api.not_found", run.answeredCode());
    }

    @Test
    void underCatchAllFalseThatPathIsTheAppsToAnswer() throws Exception {
        Run run = new Run("{\"catchAll\": false}");

        run.send(new MockHttpServletRequest("GET", "/v1/nothing"));

        assertTrue(run.chainCalled);
    }

    @Test
    void aMethodNoRouteServesOnAServedPathIsTheApisNotFoundToo() throws Exception {
        Run run = new Run("{}");

        run.send(new MockHttpServletRequest("DELETE", "/v1/tasks"));

        assertEquals(404, run.servletResponse.getStatus());
        assertEquals("api.not_found", run.answeredCode());
    }

    @Test
    void aCorsPreflightIsLeftToTheAppsCorsSetup() throws Exception {
        Run run = new Run("{}");
        MockHttpServletRequest preflight = new MockHttpServletRequest("OPTIONS", "/v1/tasks");
        preflight.addHeader("Origin", "https://app.example");
        preflight.addHeader("Access-Control-Request-Method", "POST");

        run.send(preflight);

        assertTrue(run.chainCalled);
    }

    @Test
    void anOperationLeftUnboundUnderWarnAnswersTheApisNotFound() throws Exception {
        Run run = new Run("{}");
        run.boundary.answerNotFoundFor(List.of("createTask"));

        run.send(post("{}"));

        assertFalse(run.chainCalled);
        assertEquals("api.not_found", run.answeredCode());
    }

    @Test
    void aBodyWithinTheLimitAndOfTheDeclaredMediaReachesTheHandlerChainHeld() throws Exception {
        Run run = new Run("{}");
        AtomicReference<String> seen = new AtomicReference<>();
        run.chain = (request, response) -> {
            seen.set(new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
            run.markReplied(request);
        };

        run.send(post("{\"a\": 1}"));

        assertEquals("{\"a\": 1}", seen.get());
        assertEquals(200, run.servletResponse.getStatus());
    }

    @Test
    void anEmptyBodyNeedsNoMediaType() throws Exception {
        Run run = new Run("{}");
        run.chain = (request, response) -> run.markReplied(request);
        MockHttpServletRequest empty = new MockHttpServletRequest("POST", "/v1/tasks");

        run.send(empty);

        assertEquals(200, run.servletResponse.getStatus());
    }

    @Test
    void aDeclaredLengthAboveTheLimitIsPayloadTooLargeBeforeAnyRead() throws Exception {
        Run run = new Run("{}");

        run.send(post("{\"a\": \"" + "x".repeat(40) + "\"}"));

        assertEquals(413, run.servletResponse.getStatus());
        assertEquals("api.too_large", run.answeredCode());
        assertFalse(run.chainCalled);
    }

    @Test
    void aBodyOfAnotherMediaTypeIsUnsupportedMediaType() throws Exception {
        Run run = new Run("{}");
        MockHttpServletRequest request = post("{}");
        request.setContentType("text/plain");

        run.send(request);

        assertEquals(415, run.servletResponse.getStatus());
        assertEquals("api.media", run.answeredCode());
    }

    @Test
    void aGzipBodyThatInflatesPastTheLimitIsPayloadTooLarge() throws Exception {
        Run run = new Run("{}");
        MockHttpServletRequest request = encoded(gzip("{\"a\": \"" + "x".repeat(200) + "\"}"), "gzip");

        run.send(request);

        assertEquals(413, run.servletResponse.getStatus());
        assertEquals("api.too_large", run.answeredCode());
    }

    @Test
    void aCorruptGzipBodyIsASchemaInvalidRefusal() throws Exception {
        Run run = new Run("{}");

        run.send(encoded("not gzip".getBytes(StandardCharsets.UTF_8), "gzip"));

        assertEquals(400, run.servletResponse.getStatus());
        assertEquals("api.invalid", run.answeredCode());
    }

    @Test
    void anUnknownOrStackedContentCodingIsUnsupportedMediaType() throws Exception {
        Run unknown = new Run("{}");
        Run stacked = new Run("{}");
        MockHttpServletRequest twice = encoded("{}".getBytes(StandardCharsets.UTF_8), "gzip");
        twice.addHeader("Content-Encoding", "gzip");

        unknown.send(encoded("{}".getBytes(StandardCharsets.UTF_8), "br"));
        stacked.send(twice);

        assertEquals("api.media", unknown.answeredCode());
        assertEquals("api.media", stacked.answeredCode());
    }

    @Test
    void anExceptionThatEscapesTheChainIsTheApis500AndReachesTheListener() throws Exception {
        Run run = new Run("{}");
        run.chain = (request, response) -> {
            throw new IllegalStateException("handler blew up");
        };

        run.send(post("{}"));

        assertEquals(500, run.servletResponse.getStatus());
        assertEquals("api.internal", run.answeredCode());
        assertEquals(1, run.failures.size());
        assertEquals("handler blew up", run.failures.getFirst().cause().orElseThrow().getMessage());
    }

    @Test
    void aRefusalThrownInTheChainIsWrittenWithItsCode() throws Exception {
        Run run = new Run("{}");
        run.chain = (request, response) -> {
            throw new ContractRefusal("api.invalid", MAPPER.createObjectNode());
        };

        run.send(post("{}"));

        assertEquals(400, run.servletResponse.getStatus());
        assertEquals("api.invalid", run.answeredCode());
    }

    private static MockHttpServletRequest post(String body) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v1/tasks");
        request.setContentType("application/json");
        request.setContent(body.getBytes(StandardCharsets.UTF_8));

        return request;
    }

    private static MockHttpServletRequest encoded(byte[] body, String coding) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v1/tasks");
        request.setContentType("application/json");
        request.addHeader("Content-Encoding", coding);
        request.setContent(body);

        return request;
    }

    private static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bytes)) {
            gzip.write(text.getBytes(StandardCharsets.UTF_8));
        }

        return bytes.toByteArray();
    }

    /** One boundary filter over a chain that records whether it was reached. */
    private static final class Run {
        final MockHttpServletResponse servletResponse = new MockHttpServletResponse();
        final List<UnexpectedErrorListener.UnexpectedFailure> failures = new ArrayList<>();
        final SeampactBoundary boundary;
        boolean chainCalled;
        FilterChain chain = (request, response) -> { };

        Run(String settings) {
            StaticListableBeanFactory beans = new StaticListableBeanFactory();
            beans.addBean("listener", (UnexpectedErrorListener) failures::add);
            boundary = new SeampactBoundary(TABLE.replace("%SETTINGS%", settings), new TasksTestBinding(Map.of()), beans, new StandardEnvironment());
        }

        void send(MockHttpServletRequest request) throws Exception {
            FilterChain recording = (passed, answered) -> {
                chainCalled = true;
                chain.doFilter(passed, answered);
            };

            new BoundaryFilter(boundary).doFilter(request, servletResponse, recording);
        }

        // What the reply handler does for an admitted request: a reply the boundary wrote.
        void markReplied(jakarta.servlet.ServletRequest request) {
            BoundaryExchange exchange = boundary.exchangeOf((jakarta.servlet.http.HttpServletRequest) request).orElseThrow();
            exchange.response.setStatus(200);
            exchange.markBoundaryWrote();
        }

        String answeredCode() throws IOException {
            JsonNode body = MAPPER.readTree(servletResponse.getContentAsString());

            return body.path("code").asString();
        }
    }
}
