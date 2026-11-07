package io.github.jubasse.seampact.springboot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

// The header params the contract table lists for an idempotency fingerprint (ADR 0012 "Target obligations").
class FingerprintHeadersTest {
    // A header-tagged union: the tag selects the body variant, and two variants may share a body.
    private val createEvent = Json.parseToJsonElement(
        """
        {"id": "createEvent", "idempotency": {"kind": "derived", "enforce": "boundary"},
         "params": {"path": [], "query": [], "header": [
           {"name": "X-Event-Kind", "derivedFrom": {"derivation": "union.headerTag", "from": []}},
           {"name": "traceparent", "derivedFrom": {"derivation": "identity.header", "from": []}},
           {"name": "Idempotency-Key", "derivedFrom": {"derivation": "idempotency.write", "from": []}},
           {"name": "X-Request-Source", "origin": {"layer": "api", "pointer": "/operations/createEvent"}}
         ]}}
        """,
    )

    @Test
    fun aRetryWithTheSameBodyAndAnotherUnionTagDoesNotMatch() {
        val listed = fingerprintHeaders(listOf(createEvent))["createEvent"]

        assertEquals(JsonArray(listOf("x-event-kind", "x-request-source").map(::JsonPrimitive)), listed)
    }
}
