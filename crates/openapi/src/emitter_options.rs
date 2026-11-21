//! The emitter options of A40 (ADR 0011): which `x-seampact-*` extensions a document keeps,
//! whether it keeps their reasons, whether request bodies point at strict input schemas, and the
//! `servers` it lists.

use seampact_json::JsonValue;
use seampact_target::Refusal;

use crate::OpenApiError;
use crate::not_ported::not_ported_yet;

/// The name of one `x-seampact-*` extension a document may keep.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExtensionName(String);

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

/// Reads the raw `openapi` options of a config; absent options are the defaults.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub fn parse_emitter_options(
    _raw: Option<&JsonValue>,
) -> Result<ParsedEmitterOptions, OpenApiError> {
    Err(not_ported_yet("parseEmitterOptions"))
}
