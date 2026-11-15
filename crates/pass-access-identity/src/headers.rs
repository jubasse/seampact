//! The `headers` catalogue (FR-28, ADR 0002 section 9): identity header declarations by semantic,
//! `name` and `in` for every semantic but `versionToken`, which declares `response` and `request`
//! instead (the authoring schema refuses the other pair), and the schema of a declaration from
//! the schema service.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, HeaderDecl, HeaderId, HeaderSemantic, HeaderSide, TypeUse};
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::read::{access_identity_entries, access_identity_member, access_identity_string};
use crate::report::{AccessIdentityProblem, AccessIdentityReporter, AccessIdentityRule};
use crate::schema_use::access_identity_schema_use;

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
    id: &str,
    pointer: &str,
    raw: &JsonObject,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<Option<AccessIdentityHeader>, PassError> {
    let semantic = access_identity_string(raw, "semantic").and_then(HeaderSemantic::known);
    let origin = reporter.origin(pointer);

    // The authoring schema requires a known semantic.
    let (Some(semantic), Some(origin)) = (semantic, origin) else {
        return Err(InternalError::new(format!(
            "the identity header at {pointer} has no known semantic or no origin"
        ))
        .into());
    };

    let sides = if semantic == HeaderSemantic::VersionToken {
        version_token_sides(raw)
    } else {
        named_sides(raw)
    };

    if !sides.missing.is_empty() {
        let missing: Vec<String> = sides
            .missing
            .iter()
            .map(|member| format!("'{member}'"))
            .collect();
        let fix = if semantic == HeaderSemantic::VersionToken {
            "Declare the 'response' header that carries the token and the 'request' header compared on use."
        } else {
            "Declare the header's 'name' and the message it travels in, 'in: request' or 'in: response'."
        };

        reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::HeaderDeclaration,
            message: format!("{semantic} header '{id}' has no {}", missing.join(", ")),
            fix: fix.to_owned(),
            pointer: pointer.to_owned(),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let direction = if sides.in_side == Some(HeaderSide::Response) {
        Direction::Output
    } else {
        Direction::Input
    };
    let schema_pointer = pointer_below(pointer, &["schema"]);
    let schema_written = access_identity_member(raw, "schema").is_some();
    let schema = if schema_written {
        Some(access_identity_schema_use(
            schemas,
            &schema_pointer,
            &direction,
        )?)
    } else {
        None
    };

    if semantic == HeaderSemantic::ActorSurface
        && let Some(schema) = &schema
        && !matches!(schema, TypeUse::Enum(_))
    {
        reporter.error(access_identity_actor_surface_refusal(
            AccessIdentityRule::HeaderDeclaration,
            id,
            &schema_pointer,
            schema.tag(),
        ))?;

        return Ok(None);
    }

    let declaration = HeaderDecl {
        id: HeaderId::new(id.to_owned()),
        semantic,
        name: sides.members.name,
        r#in: sides.members.r#in,
        response: sides.members.response,
        request: sides.members.request,
        schema,
        origin,
    };

    Ok(Some(AccessIdentityHeader {
        declaration,
        pointer: pointer.to_owned(),
        schema_written,
        direction,
    }))
}

fn named_sides(raw: &JsonObject) -> HeaderSides {
    let name = access_identity_string(raw, "name").map(str::to_owned);
    let side = match access_identity_string(raw, "in") {
        Some("request") => Some(HeaderSide::Request),
        Some("response") => Some(HeaderSide::Response),
        _ => None,
    };
    let mut missing = Vec::new();

    if name.is_none() {
        missing.push("name");
    }

    if side.is_none() {
        missing.push("in");
    }

    HeaderSides {
        members: HeaderSideMembers {
            name,
            r#in: side.clone(),
            ..HeaderSideMembers::default()
        },
        in_side: side,
        missing,
    }
}

fn version_token_sides(raw: &JsonObject) -> HeaderSides {
    let response = access_identity_string(raw, "response").map(str::to_owned);
    let request = access_identity_string(raw, "request").map(str::to_owned);
    let mut missing = Vec::new();

    if response.is_none() {
        missing.push("response");
    }

    if request.is_none() {
        missing.push("request");
    }

    HeaderSides {
        members: HeaderSideMembers {
            response,
            request,
            ..HeaderSideMembers::default()
        },
        in_side: None,
        missing,
    }
}

/// The refusal of an actorSurface header schema that is no enum (ADR 0002 section 9: a strict
/// enum).
pub(crate) fn access_identity_actor_surface_refusal(
    rule: AccessIdentityRule,
    header: &str,
    pointer: &str,
    kind: &str,
) -> AccessIdentityProblem {
    AccessIdentityProblem {
        rule,
        message: format!(
            "actorSurface header '{header}' has a schema of kind {kind}; an actor surface is a strict enum"
        ),
        fix: "Name the enum of the product's surfaces as the header's schema, such as 'schema: { enum: Surface }'.".to_owned(),
        pointer: pointer.to_owned(),
        related: Vec::new(),
    }
}
