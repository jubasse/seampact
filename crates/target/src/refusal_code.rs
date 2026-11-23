//! The codes of the unified refusal list that Rust code builds, one `const` each.
//!
//! A refusal is built with [`Refusal::new`](crate::Refusal::new) and one of these, never a
//! literal at the site. Codes derived from a form (`<form>.unsupported`), from a support check
//! (`ir.kind.unsupported`) or from the registry (`TargetLookupCode`) have their own enum.

/// An artefact the app switches that the target does not declare.
pub const ARTEFACT_UNKNOWN: &str = "artefact.unknown";

/// A generated file whose extension the writer does not know.
pub const FILE_EXTENSION_UNSUPPORTED: &str = "file.extension.unsupported";

/// A generated file the writer's formatter rejects.
pub const FILE_FORMAT_FAILED: &str = "file.format.failed";

/// A header field that would break the generated header line.
pub const FILE_HEADER_UNSAFE: &str = "file.header.unsafe";

/// A generated path the writer refuses.
pub const FILE_PATH_INVALID: &str = "file.path.invalid";

/// A generated PHP file that does not start with its open tag line.
pub const FILE_PHP_OPEN_TAG: &str = "file.php.open-tag";

/// An open-enum value of the IR that a target does not know.
pub const IR_VALUE_UNKNOWN: &str = "ir.value.unknown";

/// A link that points at a descriptor of another kind.
pub const LINK_KIND_MISMATCH: &str = "link.kind.mismatch";

/// A link a target consumes and the entry does not give.
pub const LINK_MISSING: &str = "link.missing";

/// A link whose descriptor style the target does not read.
pub const LINK_STYLE_UNSUPPORTED: &str = "link.style.unsupported";

/// Target options that do not have the target's shape.
pub const OPTIONS_INVALID: &str = "options.invalid";

/// A target option the target does not know.
pub const OPTIONS_UNKNOWN: &str = "options.unknown";

/// A merged document whose apps give different versions of one api.
pub const OPENAPI_MERGE_API_VERSIONS: &str = "openapi.merge.api-versions";

/// A merged document that holds no api.
pub const OPENAPI_MERGE_EMPTY: &str = "openapi.merge.empty";

/// A merged document whose apis define different elements under one name.
pub const OPENAPI_MERGE_NAME_CLASH: &str = "openapi.merge.name-clash";

/// A merged document whose prefix names an api none of its apps gives.
pub const OPENAPI_MERGE_PREFIX_API: &str = "openapi.merge.prefix-api";

/// A merged document prefix that is no component key segment.
pub const OPENAPI_MERGE_PREFIX_INVALID: &str = "openapi.merge.prefix-invalid";

/// A merged document whose apis answer one method and path, or one path under different parameter names.
pub const OPENAPI_MERGE_ROUTE_CLASH: &str = "openapi.merge.route-clash";

/// A merged document that names a document its api does not declare.
pub const OPENAPI_MERGE_UNKNOWN_DOCUMENT: &str = "openapi.merge.unknown-document";

/// OpenAPI emitter options that do not have the emitter's shape.
pub const OPENAPI_OPTIONS_INVALID: &str = "openapi.options.invalid";

/// A generated file edited by hand since the writer wrote it.
pub const WRITER_FILE_EDITED: &str = "writer.file.edited";

/// A file in the output directory that the writer did not generate.
pub const WRITER_FILE_NOT_GENERATED: &str = "writer.file.not-generated";

/// A manifest the writer cannot read.
pub const WRITER_MANIFEST_INVALID: &str = "writer.manifest.invalid";

/// A manifest path that is not a regular file.
pub const WRITER_MANIFEST_NOT_REGULAR: &str = "writer.manifest.not-regular";

/// A manifest another entry owns.
pub const WRITER_MANIFEST_OTHER_OWNER: &str = "writer.manifest.other-owner";

/// A generated path that leaves the output directory.
pub const WRITER_PATH_OUTSIDE: &str = "writer.path.outside";
