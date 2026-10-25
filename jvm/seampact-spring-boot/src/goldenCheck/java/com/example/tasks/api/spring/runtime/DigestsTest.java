package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.tasks.api.spring.TasksContractTable;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.JsonNodeFactory;

// The vectors are what the Node targets' `sha256Hex` and `sha256Base64Url` give over `JSON.stringify` with sorted
// members, so an idempotency key, a throttle key and an ETag are equal across targets.
class DigestsTest {
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    @Test
    void idempotencyKeyPartsDigestAsOnTheNodeTargets() {
        List<JsonNode> parts = List.of(NODES.stringNode("tasks"), NODES.stringNode("createTask"), NODES.stringNode("user"), NODES.stringNode(""), NODES.stringNode("key-1"));

        assertEquals("0e9711dfe19de9076c70514c7d5204e8816596cd427904fc6d562b0bbbc20cb4", Digests.hexOf(parts));
    }

    @Test
    void canonicalTextSortsMembersAndWritesNumbersAndEscapesAsJavaScript() {
        JsonNode value = JsonMapper.builder().build().readTree(
                "{\"b\":1.5,\"a\":[1e21,1e-7,0.000001,-2,100],\"é\":\"line\\nbreak\\u0001\\\"q\\\"\",\"Z\":true,\"_\":null}");

        assertEquals("{\"Z\":true,\"_\":null,\"a\":[1e+21,1e-7,0.000001,-2,100],\"b\":1.5,\"é\":\"line\\nbreak\\u0001\\\"q\\\"\"}", Digests.canonical(value));
        assertEquals("8418156b997e15c2cacd6ae3aa6e1a0bc3a66cfae86c8eca7147160fce9bc420", Digests.hexOf(List.of(value)));
        assertEquals("hBgVa5l-FcLKzWrjqm4aC8OmbProbI7KcUcWD86bxCA", Digests.base64UrlOf(List.of(value)));
    }

    // `JSON.stringify` writes array-index member names (canonical integers below 2^32 - 1) first, in numeric order.
    @Test
    void canonicalTextWritesIndexLikeMemberNamesFirstAsJavaScript() {
        JsonNode value = JsonMapper.builder().build().readTree(
                "{\"b\":3,\"10\":1,\"9\":2,\"4294967295\":4,\"01\":5,\"4294967294\":6,\"-1\":7}");

        assertEquals("{\"9\":2,\"10\":1,\"4294967294\":6,\"-1\":7,\"01\":5,\"4294967295\":4,\"b\":3}", Digests.canonical(value));
        assertEquals("c7792be0e4e3e7cc71460895bde011d733bcbb0c495cbb3fd0540a551aff078b", Digests.hexOf(List.of(value)));
    }

    // The step 6 input tree keys headers by their declared names; the Node targets key them in lower case.
    private static JsonNode createTaskInput(String authorization, String csrfToken) {
        return JsonMapper.builder().build().readTree("""
                {"path": {"channelId": "c1"}, "query": {},
                 "headers": {"Authorization": "%s", "X-Csrf-Token": "%s", "Idempotency-Key": "key-1"},
                 "body": {"title": "Plan"}}
                """.formatted(authorization, csrfToken));
    }

    @Test
    void aRetryAfterATokenRefreshHasTheFirstRequestsFingerprintAsOnTheNodeTargets() {
        ContractTable table = new ContractTable(BoundaryMapper.create().readTree(TasksContractTable.json()));
        JsonNode createTask = table.routes().stream().filter(route -> route.id().equals("createTask")).findFirst().orElseThrow().operation();

        String first = IdempotencyStep.fingerprint(createTask, createTaskInput("Bearer user-old", "csrf-old"));
        String retry = IdempotencyStep.fingerprint(createTask, createTaskInput("Bearer user-refreshed", "csrf-refreshed"));

        assertEquals(first, retry);
        assertEquals("583a81024c92d216cb3209acd8ccdd6f1350f6947a6636235ed8329fc77fde9c", first);
    }
}
