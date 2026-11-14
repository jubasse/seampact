//! The `headers` catalogue (FR-28, ADR 0002 section 9): identity header declarations by semantic,
//! `name` and `in` for every semantic but `versionToken`, which declares `response` and `request`
//! instead (the authoring schema refuses the other pair), and the schema of a declaration from
//! the schema service.

use indexmap::IndexMap;
use seampact_ir::{Direction, HeaderDecl, HeaderSide};
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::access_identity_entries;
use crate::report::{AccessIdentityProblem, AccessIdentityReporter, AccessIdentityRule};

/// The semantics a header declaration may have.
pub(crate) const HEADER_SEMANTICS: &[&str] =
    &["deadline", "traceContext", "actorSurface", "versionToken"];

pub(crate) fn is_header_semantic(text: Option<&str>) -> bool {
    text.is_some_and(|semantic| HEADER_SEMANTICS.contains(&semantic))
}

/// A header declaration with what its uses need: whether a schema is written and the direction it
/// is read in.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessIdentityHeader {
    pub(crate) declaration: HeaderDecl,
    pub(crate) pointer: String,
    /// Whether the declaration writes a `schema`, answered by the schema service or not.
    pub(crate) schema_written: bool,
    /// The direction of the header's schema: its `in` side, input for a `versionToken` (input and
    /// output).
    pub(crate) direction: Direction,
}

/// The members a header declaration takes from its written sides.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct HeaderSideMembers {
    pub(crate) name: Option<String>,
    pub(crate) r#in: Option<HeaderSide>,
    pub(crate) response: Option<String>,
    pub(crate) request: Option<String>,
}

/// The sides of a header declaration as written, and the members it lacks.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HeaderSides {
    pub(crate) members: HeaderSideMembers,
    pub(crate) in_side: Option<HeaderSide>,
    pub(crate) missing: Vec<&'static str>,
}

/// The identity headers of the api, by id, in written order; a declaration with an error is left
/// out.
pub(crate) fn access_identity_headers(
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<IndexMap<String, AccessIdentityHeader>, PassError> {
    let raw = reporter.raw();
    let mut headers = IndexMap::new();

    for (id, written) in access_identity_entries(&raw.merged, "headers") {
        let pointer = pointer_below("", &["headers", id]);

        if let Some(header) = header_of(id, &pointer, written, schemas, reporter)? {
            headers.insert(id.to_owned(), header);
        }
    }

    Ok(headers)
}

fn header_of(
    _id: &str,
    _pointer: &str,
    _raw: &JsonObject,
    _schemas: &dyn TreeSchemaService,
    _reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<Option<AccessIdentityHeader>, PassError> {
    Err(not_ported_yet("headerOf"))
}

fn named_sides(_raw: &JsonObject) -> Result<HeaderSides, PassError> {
    Err(not_ported_yet("namedSides"))
}

fn version_token_sides(_raw: &JsonObject) -> Result<HeaderSides, PassError> {
    Err(not_ported_yet("versionTokenSides"))
}

/// The refusal of an actorSurface header schema that is no enum (ADR 0002 section 9: a strict
/// enum).
pub(crate) fn access_identity_actor_surface_refusal(
    _rule: AccessIdentityRule,
    _header: &str,
    _pointer: &str,
    _kind: &str,
) -> Result<AccessIdentityProblem, PassError> {
    Err(not_ported_yet("accessIdentityActorSurfaceRefusal"))
}
