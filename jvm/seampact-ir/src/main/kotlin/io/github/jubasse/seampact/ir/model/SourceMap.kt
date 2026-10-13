// Generated from packages/spec/schemas/ir/source-map.schema.json by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write
@file:OptIn(ExperimentalSerializationApi::class)

package io.github.jubasse.seampact.ir.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** A location in a source file. */
@Serializable
public data class SourceLocation(
    /** Relative to the workspace root, with forward slashes: never absolute, no '.' or '..' segment, no backslash or ':'. */
    public val file: String,
    public val line: Long,
    public val column: Long,
    public val endLine: Long,
    public val endColumn: Long,
)

@Serializable
public data class SourceMap(
    public val irRevision: Long,
    /** Keyed by '<layer>#<pointer>', the serialised form of an Origin; a 'core' origin has no entry (ADR 0004 section 11). */
    public val locations: Map<String, SourceLocation>,
)
