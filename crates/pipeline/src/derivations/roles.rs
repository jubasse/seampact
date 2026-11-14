//! The derivation roles of ADR 0006 section 6: every role, its default code with status and
//! nature, and the data the boundary produces for it.
//!
//! The default codes form part of every api's registry, so a contract with no pack compiles. Each
//! datum's `type_use` is the type use of the default code's param of that name. The data is
//! shared by every compile and never written: a half clones a datum's type use into its output.

use std::sync::LazyLock;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, DecimalLiteral, ErrorRole, NatureBase, Pattern, RefTypeUse, Refinements,
    ScalarType, ScalarTypeUse, SchemaId, TypeUse,
};
use seampact_naming::{CanonicalIdOptions, Name, Role, canonical_id, split_name};

/// Whether a datum must reach a param of the bound code (ADR 0006 section 6, the Data column).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatumRequired {
    /// The datum has a value wherever the role answers.
    Always,
    /// The datum is never required.
    Never,
    /// The datum is required under the datum's `condition`.
    Conditional,
}

/// One datum the boundary produces for a role.
#[derive(Debug, Clone, PartialEq)]
pub struct RoleDatum {
    /// The datum name, the name of the param it fills.
    pub name: &'static str,
    /// Whether the datum must reach a param of the bound code.
    pub required: DatumRequired,
    /// For `Conditional`: when the datum is required, as the ADR states it.
    pub condition: Option<&'static str>,
    /// The type use of the default code's param of that name.
    pub type_use: TypeUse,
}

/// One role of ADR 0006 section 6.
#[derive(Debug, Clone, PartialEq)]
pub struct DerivationRole {
    /// The role.
    pub role: ErrorRole,
    /// The default code bound to the role.
    pub default_code: &'static str,
    /// The HTTP status of the default code.
    pub status: u16,
    /// The nature of the default code.
    pub nature: NatureBase,
    /// The data the boundary produces for the role, in the ADR's order.
    pub data: Vec<RoleDatum>,
}

/// Where an issue of the `schemaInvalid` role sits in the request (ADR 0006 section 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueLocation {
    /// In the path.
    Path,
    /// In the query.
    Query,
    /// In a header.
    Header,
    /// In the body.
    Body,
}

impl IssueLocation {
    /// The values of an issue's `in`, in the order of ADR 0006 section 6.
    pub const ALL: [Self; 4] = [Self::Path, Self::Query, Self::Header, Self::Body];

    /// The value as the IR writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::Query => "query",
            Self::Header => "header",
            Self::Body => "body",
        }
    }
}

/// One member of an issue of the `schemaInvalid` role.
#[derive(Debug, Clone, PartialEq)]
pub struct IssueMember {
    /// The member name.
    pub name: &'static str,
    /// The member's type use.
    pub type_use: TypeUse,
}

/// The schema id of one item of the `schemaInvalid` role's `issues`: `{ in, pointer, rule }`.
pub const ISSUE_SCHEMA_ID: &str = "ApiSchemaInvalidIssue";

/// The schema id of a proof-only input's body: an object schema with no property (ADR 0004
/// section 13).
pub const EMPTY_BODY_SCHEMA_ID: &str = "ApiEmptyBody";

/// The ADR 0007 params schema id of an error code: `api.rate_limited` gives
/// `ApiRateLimitedParams`.
///
/// # Errors
///
/// An [`InternalError`] when the naming refuses the code's name, or gives no id for it.
pub fn derivation_params_schema_id(code: &str) -> Result<SchemaId, InternalError> {
    let name = Name {
        segments: split_name(code),
        role: Role::Params,
        status: None,
    };
    let id = canonical_id(&name, CanonicalIdOptions::default())
        .map_err(|error| InternalError::new(error.to_string()))?;

    id.map(SchemaId::new)
        .ok_or_else(|| InternalError::new(format!("the error code {code} names no params schema")))
}

// The largest integer a JSON number holds exactly: the bound a Retry-After header value must fit
// (ir.error.retry-header).
const MAX_SAFE_INTEGER: &str = "9007199254740991";

fn empty_refinements() -> Refinements {
    Refinements {
        min_length: None,
        max_length: None,
        pattern: None,
        minimum: None,
        maximum: None,
        exclusive_minimum: None,
        exclusive_maximum: None,
        multiple_of: None,
    }
}

fn scalar(r#type: ScalarType, refinements: Refinements) -> ScalarTypeUse {
    ScalarTypeUse {
        r#type,
        format: None,
        scalar: None,
        refinements,
        content: None,
        sensitive: None,
        nullable: None,
        docs: None,
        examples: None,
    }
}

fn text() -> ScalarTypeUse {
    scalar(ScalarType::String, empty_refinements())
}

fn count() -> ScalarTypeUse {
    scalar(
        ScalarType::Integer,
        Refinements {
            minimum: Some(DecimalLiteral::new("0".to_owned())),
            ..empty_refinements()
        },
    )
}

// `in` as a closed set: a string matching one location. The pattern uses no construct ADR 0003
// section 9 normalises, so its normalised form is its written form.
fn location() -> ScalarTypeUse {
    let names: Vec<&str> = IssueLocation::ALL.map(IssueLocation::as_str).to_vec();
    let source = format!("^(?:{})$", names.join("|"));

    scalar(
        ScalarType::String,
        Refinements {
            pattern: Some(Pattern {
                normalized: source.clone(),
                source,
            }),
            ..empty_refinements()
        },
    )
}

fn retry_after_count() -> ScalarTypeUse {
    scalar(
        ScalarType::Integer,
        Refinements {
            minimum: Some(DecimalLiteral::new("0".to_owned())),
            maximum: Some(DecimalLiteral::new(MAX_SAFE_INTEGER.to_owned())),
            ..empty_refinements()
        },
    )
}

fn datum(
    name: &'static str,
    required: DatumRequired,
    condition: Option<&'static str>,
    type_use: TypeUse,
) -> RoleDatum {
    RoleDatum {
        name,
        required,
        condition,
        type_use,
    }
}

fn issues_array() -> TypeUse {
    TypeUse::Array(ArrayTypeUse {
        items: Box::new(TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new(ISSUE_SCHEMA_ID.to_owned()),
            unknown_keys: None,
            nullable: None,
            docs: None,
            examples: None,
        })),
        min_items: None,
        max_items: None,
        nullable: None,
        docs: None,
        examples: None,
    })
}

fn role(
    name: ErrorRole,
    default_code: &'static str,
    status: u16,
    nature: NatureBase,
    data: Vec<RoleDatum>,
) -> DerivationRole {
    DerivationRole {
        role: name,
        default_code,
        status,
        nature,
        data,
    }
}

/// The members of one issue, in the order of ADR 0006 section 6.
#[must_use]
pub fn derivation_issue_members() -> Vec<IssueMember> {
    vec![
        IssueMember {
            name: "in",
            type_use: TypeUse::Scalar(location()),
        },
        IssueMember {
            name: "pointer",
            type_use: TypeUse::Scalar(text()),
        },
        IssueMember {
            name: "rule",
            type_use: TypeUse::Scalar(text()),
        },
    ]
}

fn leading_roles() -> Vec<DerivationRole> {
    use DatumRequired::{Always, Conditional};
    use NatureBase::{Refused, Unavailable};

    vec![
        role(
            ErrorRole::SchemaInvalid,
            "api.schema_invalid",
            400,
            Refused,
            vec![datum("issues", Always, None, issues_array())],
        ),
        role(
            ErrorRole::Unauthenticated,
            "api.unauthenticated",
            401,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::Forbidden,
            "api.forbidden",
            403,
            Refused,
            vec![datum(
                "pointer",
                Conditional,
                Some("on an operation with a rejected restricted input field, absent otherwise"),
                TypeUse::Scalar(text()),
            )],
        ),
        role(
            ErrorRole::CsrfInvalid,
            "api.csrf_invalid",
            403,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::SortKeyForbidden,
            "api.sort_key_forbidden",
            403,
            Refused,
            vec![datum("key", Always, None, TypeUse::Scalar(text()))],
        ),
        role(ErrorRole::NotFound, "api.not_found", 404, Refused, vec![]),
        role(
            ErrorRole::StateConflict,
            "state.conflict",
            409,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::IdempotencyInProgress,
            "api.idempotency_in_progress",
            409,
            Unavailable,
            vec![],
        ),
        role(
            ErrorRole::PreconditionFailed,
            "api.precondition_failed",
            412,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::IdempotencyKeyReused,
            "api.idempotency_key_reused",
            422,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::PreconditionRequired,
            "api.precondition_required",
            428,
            Refused,
            vec![],
        ),
    ]
}

fn trailing_roles() -> Vec<DerivationRole> {
    use DatumRequired::{Conditional, Never};
    use NatureBase::{Failed, Refused, Unavailable};

    vec![
        role(ErrorRole::Gone, "api.cursor_too_old", 410, Refused, vec![]),
        role(
            ErrorRole::PayloadTooLarge,
            "api.payload_too_large",
            413,
            Refused,
            vec![datum("limitBytes", Never, None, TypeUse::Scalar(count()))],
        ),
        role(
            ErrorRole::UnsupportedMediaType,
            "api.unsupported_media_type",
            415,
            Refused,
            vec![],
        ),
        role(
            ErrorRole::RateLimited,
            "api.rate_limited",
            429,
            Unavailable,
            vec![datum(
                "retryAfterMs",
                Conditional,
                Some("when conventions.rateLimit names it"),
                TypeUse::Scalar(retry_after_count()),
            )],
        ),
        role(
            ErrorRole::UndeclaredStatus,
            "api.internal",
            500,
            Failed,
            vec![],
        ),
        role(
            ErrorRole::UpstreamUnavailable,
            "api.upstream_unavailable",
            502,
            Unavailable,
            vec![],
        ),
        role(
            ErrorRole::ServiceUnavailable,
            "api.service_unavailable",
            503,
            Unavailable,
            vec![],
        ),
        role(
            ErrorRole::UpstreamTimeout,
            "api.upstream_timeout",
            504,
            Unavailable,
            vec![],
        ),
        role(
            ErrorRole::DeadlineExceeded,
            "api.deadline_exceeded",
            504,
            Unavailable,
            vec![],
        ),
    ]
}

fn build_roles() -> Vec<DerivationRole> {
    let mut roles = leading_roles();

    roles.extend(trailing_roles());

    roles
}

static DERIVATION_ROLES: LazyLock<Vec<DerivationRole>> = LazyLock::new(build_roles);

/// Every role of ADR 0006 section 6, in the ADR's order.
#[must_use]
pub fn derivation_roles() -> &'static [DerivationRole] {
    &DERIVATION_ROLES
}

/// The role of a name, with its default code.
#[must_use]
pub fn derivation_role_of(name: &ErrorRole) -> Option<&'static DerivationRole> {
    DERIVATION_ROLES.iter().find(|entry| entry.role == *name)
}

// `rateLimited`'s conditional datum, the delay, fills the param `conventions.rateLimit` names
// wherever it names one.
fn fills_rate_limit_param(
    role: &ErrorRole,
    datum: &RoleDatum,
    rate_limit_param: Option<&str>,
) -> bool {
    *role == ErrorRole::RateLimited
        && datum.required == DatumRequired::Conditional
        && rate_limit_param.is_some()
}

/// The param a datum fills by name: `rateLimited`'s delay fills the param `conventions.rateLimit`
/// names.
#[must_use]
pub fn derivation_param_of_datum<'name>(
    role: &ErrorRole,
    datum: &'name RoleDatum,
    rate_limit_param: Option<&'name str>,
) -> &'name str {
    match rate_limit_param {
        Some(param) if fills_rate_limit_param(role, datum, rate_limit_param) => param,
        _ => datum.name,
    }
}

/// Whether a datum has a value wherever its role answers (ADR 0006 section 6, the Data column).
///
/// `forbidden`'s pointer is supplied only on a rejected restricted input field, never on the
/// other denials the role answers on the same operation.
#[must_use]
pub fn derivation_datum_always(
    role: &ErrorRole,
    datum: &RoleDatum,
    rate_limit_param: Option<&str>,
) -> bool {
    datum.required == DatumRequired::Always || fills_rate_limit_param(role, datum, rate_limit_param)
}
