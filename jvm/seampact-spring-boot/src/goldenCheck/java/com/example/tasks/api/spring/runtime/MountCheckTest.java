package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.JsonNode;

/** The boot check's mount rule (ADR 0022 "The boot check"). */
class MountCheckTest {
    private static final String CONTEXT_PATH_PROPERTY = "server.servlet.context-path";
    private static final String NO_SERVLET_PATH = "";

    private static JsonNode settingsOf(String settingsJson) {
        return BoundaryMapper.create().readTree(settingsJson);
    }

    @Test
    void anAppWithAContextPathOrAServletPathStartsWhenNoMountIsConfigured() {
        MockEnvironment environment = new MockEnvironment().withProperty(CONTEXT_PATH_PROPERTY, "/app");

        assertEquals(Optional.empty(), BootCheck.mountProblem(settingsOf("{}"), environment, NO_SERVLET_PATH));
        assertEquals(Optional.empty(), BootCheck.mountProblem(settingsOf("{}"), new MockEnvironment(), "/api"));
    }

    @Test
    void aConfiguredMountMustEqualTheContextPathThenTheServletPath() {
        MockEnvironment environment = new MockEnvironment().withProperty(CONTEXT_PATH_PROPERTY, "/app/");

        assertEquals(Optional.empty(), BootCheck.mountProblem(settingsOf("{\"mount\": \"/app/api\"}"), environment, "/api"));
        assertTrue(BootCheck.mountProblem(settingsOf("{\"mount\": \"/other\"}"), environment, "/api").isPresent());
        assertTrue(BootCheck.mountProblem(settingsOf("{\"mount\": \"/app\"}"), new MockEnvironment(), NO_SERVLET_PATH).isPresent());
    }
}
