package com.example.optins.api.spring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.example.optins.api.BrowseTaskInput;
import com.example.optins.api.BrowseTaskResult;
import com.example.optins.api.GetTaskInput;
import com.example.optins.api.GetTaskResult;
import com.example.optins.api.InternalEndpoints;
import com.example.optins.api.PeekTaskInput;
import com.example.optins.api.PeekTaskResult;
import com.example.optins.api.SignTaskInput;
import com.example.optins.api.SignTaskResult;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The opt-ins tree's springdoc annotations and `frameworkDocs: off` file in a running springdoc: the framework's
 * document shows each operation's declared body schema, never the handler's result wrapper, and the generated file
 * turns that document off.
 */
class SpringdocDocumentTest {
    private static final String DOCS_PATH = "/v3/api-docs";
    private static final String FRAMEWORK_DOCS_FILE = "seampact-tasksService.properties";
    private static final int OK = 200;
    private static final int NOT_FOUND = 404;

    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class DocsApp {
        @Bean
        SecurityFilterChain openChain(HttpSecurity http) throws Exception {
            return http.authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll()).build();
        }

        @Bean
        InternalController internalController() {
            return new InternalController();
        }
    }

    // The documented handlers only: the document is built from their mappings, never by calling them.
    @RestController
    static class InternalController implements InternalEndpoints {
        @Override
        @GetTask
        public GetTaskResult getTask(GetTaskInput input) {
            throw new UnsupportedOperationException("documented only");
        }

        @Override
        @BrowseTask
        public BrowseTaskResult browseTask(BrowseTaskInput input) {
            throw new UnsupportedOperationException("documented only");
        }

        @Override
        @PeekTask
        public PeekTaskResult peekTask(PeekTaskInput input) {
            throw new UnsupportedOperationException("documented only");
        }

        @Override
        @SignTask
        public SignTaskResult signTask(SignTaskInput input) {
            throw new UnsupportedOperationException("documented only");
        }
    }

    private static MvcResult docsReply(Properties properties) throws Exception {
        SpringApplicationBuilder application = new SpringApplicationBuilder(DocsApp.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.port=0")
                .properties(properties);

        try (ConfigurableApplicationContext context = application.run()) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            return mvc.perform(MockMvcRequestBuilders.get(DOCS_PATH)).andReturn();
        }
    }

    private static Properties frameworkDocsOff() throws IOException {
        Properties properties = new Properties();
        try (InputStream file = SpringdocDocumentTest.class.getClassLoader().getResourceAsStream(FRAMEWORK_DOCS_FILE)) {
            if (file == null) throw new IllegalStateException("the golden resource " + FRAMEWORK_DOCS_FILE + " is not on the classpath");
            properties.load(file);
        }

        return properties;
    }

    private static JsonNode operationOf(JsonNode document, String operationId) {
        for (JsonNode path : document.path("paths")) {
            for (JsonNode operation : path) {
                if (operationId.equals(operation.path("operationId").asString())) return operation;
            }
        }

        throw new AssertionError("the document has no operation '" + operationId + "': " + document);
    }

    @Test
    void showsTheDeclaredBodySchemaNotTheResultWrapper() throws Exception {
        MvcResult reply = docsReply(new Properties());
        assertEquals(OK, reply.getResponse().getStatus());

        JsonNode document = JsonMapper.builder().build().readTree(reply.getResponse().getContentAsString());
        JsonNode schema = operationOf(document, "getTask").path("responses").path("200").path("content").path("application/json").path("schema");

        assertEquals("#/components/schemas/Task", schema.path("$ref").asString(), schema.toString());
        assertFalse(document.path("components").path("schemas").has("GetTaskResult"), "the result wrapper is not a schema of the document");
    }

    @Test
    void frameworkDocsOffTurnsTheDocumentOff() throws Exception {
        assertEquals(NOT_FOUND, docsReply(frameworkDocsOff()).getResponse().getStatus());
    }
}
