package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.ir.model.ContractIR
import io.github.jubasse.seampact.ir.model.Deprecation
import io.github.jubasse.seampact.ir.model.Operation
import io.github.jubasse.seampact.ir.model.Origin
import io.github.jubasse.seampact.ir.model.Response
import io.github.jubasse.seampact.ir.model.ResponseHeader
import io.github.jubasse.seampact.ir.model.ResponseHeaderSemantic
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val CONCURRENCY_DERIVATION = "concurrency.version"
// RFC 8594 and RFC 9110 section 5.6.7: the IMF-fixdate of the day at 00:00:00 GMT.
private val SUNSET_DATE = DateTimeFormatter.ofPattern("EEE, dd MMM yyyy '00:00:00 GMT'", Locale.US)

/**
 * The response headers the boundary writes from a response's own IR headers (ADR 0004 section 7), listed in the
 * contract table's settings (`responseHeaders`) per operation id and status: the deprecation, sunset and successor
 * link of a deprecated operation, and the `ETag` of an item versioned by `If-Match` (grammar section 6). The other
 * response headers are written from the members that derive them: the idempotency replay, `cache.etag` and the paging
 * headers. A header this release cannot write is refused by name.
 */
internal class ResponseHeaderEntries(private val ir: ContractIR, private val refusals: Refusals) {
    private val entries = LinkedHashMap<String, LinkedHashMap<String, JsonArray>>()

    /** Reads the headers of one response; a response without a header the boundary writes lists nothing. */
    fun read(operation: Operation, response: Response, responseAt: IrPlace) {
        val written = response.headers.mapIndexedNotNull { index, header ->
            entryOf(operation, header, responseAt.below("headers", index))
        }
        if (written.isNotEmpty()) entries.getOrPut(operation.id) { LinkedHashMap() }[response.status.toString()] = JsonArray(written)
    }

    fun toJson(): JsonObject = JsonObject(entries.mapValues { (_, byStatus) -> JsonObject(byStatus) })

    // Null for a header another step writes, or one refused.
    private fun entryOf(operation: Operation, header: ResponseHeader, at: IrPlace): JsonObject? = when (header.semantic) {
        ResponseHeaderSemantic.DEPRECATION -> dateEntry(operation.deprecated, header.name, "deprecation", at) { it.since }
        ResponseHeaderSemantic.SUNSET -> dateEntry(operation.deprecated, header.name, "sunset", at) { it.sunset }
        ResponseHeaderSemantic.SUCCESSOR_LINK -> successorLinkEntry(operation.deprecated, header.name, at)
        else -> if (header.derivedFrom?.derivation == CONCURRENCY_DERIVATION) entityTagEntry(operation, header, at) else null
    }

    private fun dateEntry(deprecated: Deprecation?, name: String, semantic: String, at: IrPlace, date: (Deprecation) -> String): JsonObject? {
        if (deprecated == null) {
            refusals.inconsistent("ir.deprecation.headers", "A $semantic header on an operation that is not deprecated", at)
            return null
        }

        val day = try {
            LocalDate.parse(date(deprecated))
        } catch (_: DateTimeParseException) {
            refusals.inconsistent("ir.deprecation.since", "The $semantic header's date is not a calendar date", at)
            return null
        }

        // RFC 9745: `@` and the unix seconds of the day at 00:00:00 UTC.
        val value = if (semantic == "deprecation") "@${day.atStartOfDay(ZoneOffset.UTC).toEpochSecond()}" else SUNSET_DATE.format(day)

        return buildJsonObject {
            put("kind", "text")
            put("name", name)
            put("value", value)
        }
    }

    // The successor's contract path; the boundary puts it under the entry's mount and fills its params from the request.
    private fun successorLinkEntry(deprecated: Deprecation?, name: String, at: IrPlace): JsonObject? {
        val successor = deprecated?.successor
        val rel = deprecated?.successorRel
        if (successor == null || rel == null) {
            refusals.inconsistent("ir.deprecation.headers", "A successor link header on an operation without its successor and relation", at)
            return null
        }

        if (successor.api != ir.api.id) {
            refusals.waiting("deprecated.successor.otherApi", "The successor link to operation '${successor.id}' of api '${successor.api}'", at, Delivery.AFTER_1_0)
            return null
        }

        val successorOperation = ir.operations.find { it.id == successor.id }
        if (successorOperation == null) {
            refusals.inconsistent("ir.deprecation.successor", "The successor '${successor.id}' is no operation of the api", at)
            return null
        }

        return buildJsonObject {
            put("kind", "successorLink")
            put("name", name)
            put("path", successorOperation.path)
            put("rel", rel)
        }
    }

    // The `ETag` of an item versioned by `If-Match`, from the item property the version is compared with. A read of the
    // resource has no `concurrency`: its ETag is derived from the resource's, the origin its versioned writes name
    // first, and they give the field.
    private fun entityTagEntry(operation: Operation, header: ResponseHeader, at: IrPlace): JsonObject? {
        val field = operation.concurrency?.takeIf { it.version.in_.value == HEADER_SOURCE }?.field
            ?: resourceField(header.derivedFrom?.from?.firstOrNull(), at)
            ?: return null

        return buildJsonObject {
            put("kind", "entityTag")
            put("name", header.name)
            put("field", field)
        }
    }

    private fun resourceField(resourceOrigin: Origin?, at: IrPlace): String? {
        val fields = ir.operations.mapNotNull { candidate ->
            val concurrency = candidate.concurrency ?: return@mapNotNull null
            val origin = concurrency.derivedFrom.from.firstOrNull()
            if (concurrency.version.in_.value != HEADER_SOURCE || !isSameOrigin(origin, resourceOrigin)) null else concurrency.field
        }.toSet()

        if (fields.size == 1) return fields.single()

        if (fields.size > 1) {
            refusals.inconsistent("concurrency.etag.field", "The If-Match writes of the resource this ETag is derived from compare different fields", at)
        } else {
            refusals.waiting("concurrency.etag.withoutWrite", "An ETag of a resource whose If-Match writes are not operations of this api", at, Delivery.AFTER_1_0)
        }

        return null
    }

    private fun isSameOrigin(left: Origin?, right: Origin?): Boolean =
        left != null && right != null && left.layer == right.layer && left.pointer == right.pointer
}
