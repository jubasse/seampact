//! The emitter options of A40 (ADR 0011): which `x-seampact-*` extensions a document keeps,
//! whether it keeps their reasons, whether request bodies point at strict input schemas, and the
//! `servers` it lists.

use seampact_json::JsonValue;
use seampact_target::Refusal;

use crate::OpenApiError;
use crate::not_ported::not_ported_yet;

/// The name of one `x-seampact-*` extension a document may keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExtensionName {
    /// `access`.
    Access,
    /// `api`.
    Api,
    /// `apis`.
    Apis,
    /// `bindings`.
    Bindings,
    /// `budget-ms`.
    BudgetMs,
    /// `cache-control`.
    CacheControl,
    /// `concurrency`.
    Concurrency,
    /// `csrf`.
    Csrf,
    /// `degradable`.
    Degradable,
    /// `deprecation`.
    Deprecation,
    /// `derived-from`.
    DerivedFrom,
    /// `discriminator`.
    Discriminator,
    /// `enum`.
    Enum,
    /// `enum-fallback`.
    EnumFallback,
    /// `errors`.
    Errors,
    /// `exclusiveMaximum`.
    ExclusiveMaximum,
    /// `exclusiveMinimum`.
    ExclusiveMinimum,
    /// `filtered-by`.
    FilteredBy,
    /// `format`.
    Format,
    /// `idempotency`.
    Idempotency,
    /// `internal`.
    Internal,
    /// `maturity`.
    Maturity,
    /// `max-size`.
    MaxSize,
    /// `maximum`.
    Maximum,
    /// `minimum`.
    Minimum,
    /// `multipleOf`.
    MultipleOf,
    /// `nature`.
    Nature,
    /// `opaque`.
    Opaque,
    /// `owner`.
    Owner,
    /// `paging`.
    Paging,
    /// `principal-requires`.
    PrincipalRequires,
    /// `raw-body`.
    RawBody,
    /// `relays`.
    Relays,
    /// `requires`.
    Requires,
    /// `restricted-to`.
    RestrictedTo,
    /// `scopes`.
    Scopes,
    /// `semantic`.
    Semantic,
    /// `signature`.
    Signature,
    /// `source-api`.
    SourceApi,
    /// `unknown-keys`.
    UnknownKeys,
    /// `unknown-query`.
    UnknownQuery,
    /// `upstream`.
    Upstream,
}

impl ExtensionName {
    /// Every extension the emitter writes, in the TypeScript's `EXTENSION_NAMES` order.
    pub const ALL: [Self; 42] = [
        Self::Access,
        Self::Api,
        Self::Apis,
        Self::Bindings,
        Self::BudgetMs,
        Self::CacheControl,
        Self::Concurrency,
        Self::Csrf,
        Self::Degradable,
        Self::Deprecation,
        Self::DerivedFrom,
        Self::Discriminator,
        Self::Enum,
        Self::EnumFallback,
        Self::Errors,
        Self::ExclusiveMaximum,
        Self::ExclusiveMinimum,
        Self::FilteredBy,
        Self::Format,
        Self::Idempotency,
        Self::Internal,
        Self::Maturity,
        Self::MaxSize,
        Self::Maximum,
        Self::Minimum,
        Self::MultipleOf,
        Self::Nature,
        Self::Opaque,
        Self::Owner,
        Self::Paging,
        Self::PrincipalRequires,
        Self::RawBody,
        Self::Relays,
        Self::Requires,
        Self::RestrictedTo,
        Self::Scopes,
        Self::Semantic,
        Self::Signature,
        Self::SourceApi,
        Self::UnknownKeys,
        Self::UnknownQuery,
        Self::Upstream,
    ];

    /// The name without the `x-seampact-` prefix.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Access => "access",
            Self::Api => "api",
            Self::Apis => "apis",
            Self::Bindings => "bindings",
            Self::BudgetMs => "budget-ms",
            Self::CacheControl => "cache-control",
            Self::Concurrency => "concurrency",
            Self::Csrf => "csrf",
            Self::Degradable => "degradable",
            Self::Deprecation => "deprecation",
            Self::DerivedFrom => "derived-from",
            Self::Discriminator => "discriminator",
            Self::Enum => "enum",
            Self::EnumFallback => "enum-fallback",
            Self::Errors => "errors",
            Self::ExclusiveMaximum => "exclusiveMaximum",
            Self::ExclusiveMinimum => "exclusiveMinimum",
            Self::FilteredBy => "filtered-by",
            Self::Format => "format",
            Self::Idempotency => "idempotency",
            Self::Internal => "internal",
            Self::Maturity => "maturity",
            Self::MaxSize => "max-size",
            Self::Maximum => "maximum",
            Self::Minimum => "minimum",
            Self::MultipleOf => "multipleOf",
            Self::Nature => "nature",
            Self::Opaque => "opaque",
            Self::Owner => "owner",
            Self::Paging => "paging",
            Self::PrincipalRequires => "principal-requires",
            Self::RawBody => "raw-body",
            Self::Relays => "relays",
            Self::Requires => "requires",
            Self::RestrictedTo => "restricted-to",
            Self::Scopes => "scopes",
            Self::Semantic => "semantic",
            Self::Signature => "signature",
            Self::SourceApi => "source-api",
            Self::UnknownKeys => "unknown-keys",
            Self::UnknownQuery => "unknown-query",
            Self::Upstream => "upstream",
        }
    }
}

/// Which extensions a document keeps.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ExtensionSelection {
    /// `all`.
    #[default]
    All,
    /// `none`.
    None,
    /// The listed extensions only.
    Named(Vec<ExtensionName>),
}

/// Whether a document keeps the reasons of its extensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ReasonsOption {
    /// `include`.
    #[default]
    Include,
    /// `omit`.
    Omit,
}

/// Whether request bodies point at the shared schemas or at strict input schemas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum InputSchemasOption {
    /// `shared`.
    #[default]
    Shared,
    /// `strict`.
    Strict,
}

/// One entry of the `servers` a document lists.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ServerOption {
    /// The `url` member.
    pub url: String,
    /// The `description` member.
    pub description: Option<String>,
}

/// The emitter options; the default is the TypeScript's `DEFAULT_EMITTER_OPTIONS`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EmitterOptions {
    /// The `extensions` member.
    pub extensions: ExtensionSelection,
    /// The `reasons` member.
    pub reasons: ReasonsOption,
    /// The `inputSchemas` member.
    pub input_schemas: InputSchemasOption,
    /// The `servers` member.
    pub servers: Vec<ServerOption>,
}

/// The options read from a config, or the refusals that stop them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedEmitterOptions {
    /// The options, defaults filled in.
    Parsed(EmitterOptions),
    /// Why the options cannot be read, each naming the member and the fix.
    Refused(Vec<Refusal>),
}

/// The members the options may hold.
const OPTION_KEYS: [&str; 4] = ["extensions", "reasons", "inputSchemas", "servers"];

/// The values of the `reasons` option.
const REASONS_VALUES: [ReasonsOption; 2] = [ReasonsOption::Include, ReasonsOption::Omit];

/// The values of the `inputSchemas` option.
const INPUT_SCHEMAS_VALUES: [InputSchemasOption; 2] =
    [InputSchemasOption::Shared, InputSchemasOption::Strict];

/// Reads the raw `openapi` options of a config; absent options are the defaults.
///
/// # Errors
///
/// [`OpenApiError::Internal`] for a bug.
pub fn parse_emitter_options(
    raw: Option<&JsonValue>,
) -> Result<ParsedEmitterOptions, OpenApiError> {
    let Some(raw_options) = raw else {
        return Ok(ParsedEmitterOptions::Parsed(EmitterOptions::default()));
    };
    let JsonValue::Object(record) = raw_options else {
        return refused_with(vec![option_refusal(
            "",
            "The OpenAPI options must be a mapping.",
            "Write the options as a mapping.",
        )?]);
    };
    let mut refusals = Vec::new();

    for key in record.keys() {
        if !OPTION_KEYS.contains(&key.as_str()) {
            refusals.push(option_refusal(
                &format!("/{key}"),
                &format!("{} is not an OpenAPI option.", option_value_text(key)?),
                &format!("Use one of {}.", OPTION_KEYS.join(", ")),
            )?);
        }
    }

    let defaults = EmitterOptions::default();
    let extensions = parse_extensions(record.get("extensions"), &mut refusals)?;
    let reasons = parse_choice(
        record.get("reasons"),
        "reasons",
        &REASONS_VALUES,
        defaults.reasons,
        &mut refusals,
    )?;
    let input_schemas = parse_choice(
        record.get("inputSchemas"),
        "inputSchemas",
        &INPUT_SCHEMAS_VALUES,
        defaults.input_schemas,
        &mut refusals,
    )?;
    let servers = parse_servers(record.get("servers"), &mut refusals)?;

    if !refusals.is_empty() {
        return refused_with(refusals);
    }

    Ok(ParsedEmitterOptions::Parsed(EmitterOptions {
        extensions,
        reasons,
        input_schemas,
        servers,
    }))
}

fn option_refusal(_member: &str, _message: &str, _fix: &str) -> Result<Refusal, OpenApiError> {
    Err(not_ported_yet("optionRefusal"))
}

fn refused_with(_refusals: Vec<Refusal>) -> Result<ParsedEmitterOptions, OpenApiError> {
    Err(not_ported_yet("refusedWith"))
}

fn option_value_text(_key: &str) -> Result<String, OpenApiError> {
    Err(not_ported_yet("optionValueText"))
}

fn parse_extensions(
    _raw: Option<&JsonValue>,
    _refusals: &mut Vec<Refusal>,
) -> Result<ExtensionSelection, OpenApiError> {
    Err(not_ported_yet("parseExtensions"))
}

fn parse_choice<Choice: Copy>(
    _raw: Option<&JsonValue>,
    _option: &str,
    _values: &[Choice],
    _default_value: Choice,
    _refusals: &mut Vec<Refusal>,
) -> Result<Choice, OpenApiError> {
    Err(not_ported_yet("parseChoice"))
}

fn parse_servers(
    _raw: Option<&JsonValue>,
    _refusals: &mut Vec<Refusal>,
) -> Result<Vec<ServerOption>, OpenApiError> {
    Err(not_ported_yet("parseServers"))
}
