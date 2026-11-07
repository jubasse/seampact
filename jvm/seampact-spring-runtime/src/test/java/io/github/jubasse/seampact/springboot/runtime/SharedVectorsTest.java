package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.JsonNode;

/** The cross-language vectors of `fixtures/vectors/`, which the Node, PHP and Python runtimes read too. */
class SharedVectorsTest {
    private static final String REPOSITORY_ROOT_PROPERTY = "seampact.repositoryRoot";
    private static final String TEST_API = "tasks";

    @TestFactory
    Stream<DynamicTest> digestsWriteTheCanonicalTextAndItsSha256() {
        return vectorsOf("digests.json", "canonical").map(vector -> DynamicTest.dynamicTest(text(vector, "name"), () -> {
            List<JsonNode> parts = new ArrayList<>();
            vector.get("parts").values().forEach(parts::add);

            assertEquals(text(vector, "text"), Digests.canonical(vector.get("parts")));
            assertEquals(text(vector, "hex"), Digests.hexOf(parts));
            assertEquals(text(vector, "base64Url"), Digests.base64UrlOf(parts));
        }));
    }

    @TestFactory
    Stream<DynamicTest> bodiesDigestAsTheirStrongEtag() {
        return vectorsOf("digests.json", "bodies").map(vector -> DynamicTest.dynamicTest(text(vector, "name"), () ->
                assertEquals(text(vector, "base64Url"), Digests.base64UrlOf(text(vector, "body").getBytes(StandardCharsets.UTF_8)))));
    }

    @TestFactory
    Stream<DynamicTest> frameworkRoutePatternsTakeTheRoutesTheSharedRuleTakes() {
        return vectorsOf("framework-route-patterns.json", "vectors").map(vector -> DynamicTest.dynamicTest(text(vector, "name"), () ->
                assertEquals(vector.get("allows").asBoolean(), FrameworkRoutePattern.allows(text(vector, "allowed"), text(vector, "route")))));
    }

    @TestFactory
    Stream<DynamicTest> runtimeVersionsServeTheCodeTheGuardAccepts() {
        return vectorsOf("runtime-versions.json", "vectors").map(vector -> {
            String installed = text(vector, "installed");
            String generator = text(vector, "generator");

            return DynamicTest.dynamicTest(installed + " serves " + generator, () ->
                    assertEquals(vector.get("serves").asBoolean(), GeneratorVersionCheck.problem(TEST_API, generator, installed).isEmpty()));
        });
    }

    private static Stream<JsonNode> vectorsOf(String file, String list) {
        String repositoryRoot = System.getProperty(REPOSITORY_ROOT_PROPERTY);

        if (repositoryRoot == null) {
            throw new IllegalStateException("the test needs the system property " + REPOSITORY_ROOT_PROPERTY + "; run it through Gradle");
        }

        try {
            String json = Files.readString(Path.of(repositoryRoot, "fixtures", "vectors", file));
            JsonNode vectors = BoundaryMapper.create().readTree(json).get(list);

            if (vectors == null || !vectors.isArray()) {
                throw new IllegalStateException("fixtures/vectors/" + file + " has no '" + list + "' array");
            }

            return vectors.values().stream();
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    private static String text(JsonNode vector, String member) {
        JsonNode value = vector.get(member);

        if (value == null || !value.isString()) {
            throw new IllegalStateException("a vector's '" + member + "' is not a JSON string");
        }

        return value.asString();
    }
}
