//! The emitter options of A40 (ADR 0011): which `x-seampact-*` extensions a document keeps,
//! whether it keeps their reasons, whether request bodies point at strict input schemas, and the
//! `servers` it lists.

use seampact_diagnostics::diagnostic_inert;
use seampact_ir::bounded_unknown_text;
use seampact_json::{JsonObject, JsonValue, js_text_of};
use seampact_target::Refusal;

use crate::OpenApiError;

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

    /// The extension a name designates, if it is one the emitter writes.
    #[must_use]
    pub fn from_text(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|known| known.as_str() == name)
    }

    /// The path of the extension's JSON Schema, relative to the package.
    #[must_use]
    pub fn schema_path(self) -> String {
        format!("schemas/extensions/{}.schema.json", self.as_str())
    }

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

/// The values of the `reasons` option, each with its text.
const REASONS_VALUES: [(&str, ReasonsOption); 2] = [
    ("include", ReasonsOption::Include),
    ("omit", ReasonsOption::Omit),
];

/// The values of the `inputSchemas` option, each with its text.
const INPUT_SCHEMAS_VALUES: [(&str, InputSchemasOption); 2] = [
    ("shared", InputSchemasOption::Shared),
    ("strict", InputSchemasOption::Strict),
];

/// The code of every refusal of the options.
const OPTIONS_INVALID_CODE: &str = "openapi.options.invalid";

/// The `extensions` value that keeps every extension.
const ALL_EXTENSIONS: &str = "all";

/// The `extensions` value that keeps none.
const NO_EXTENSIONS: &str = "none";

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
        return Ok(refused_with(vec![option_refusal(
            "",
            "The OpenAPI options must be a mapping.",
            "Write the options as a mapping.",
        )]));
    };
    let mut refusals = Vec::new();

    for key in record.keys() {
        if !OPTION_KEYS.contains(&key.as_str()) {
            refusals.push(option_refusal(
                &format!("/{key}"),
                &format!(
                    "{} is not an OpenAPI option.",
                    option_value_text(&JsonValue::text(key))
                ),
                &format!("Use one of {}.", OPTION_KEYS.join(", ")),
            ));
        }
    }

    let defaults = EmitterOptions::default();
    let extensions = parse_extensions(record.get("extensions"), &mut refusals);
    let reasons = parse_choice(
        record.get("reasons"),
        "reasons",
        &REASONS_VALUES,
        defaults.reasons,
        &mut refusals,
    );
    let input_schemas = parse_choice(
        record.get("inputSchemas"),
        "inputSchemas",
        &INPUT_SCHEMAS_VALUES,
        defaults.input_schemas,
        &mut refusals,
    );
    let servers = parse_servers(record.get("servers"), &mut refusals);

    if !refusals.is_empty() {
        return Ok(refused_with(refusals));
    }

    Ok(ParsedEmitterOptions::Parsed(EmitterOptions {
        extensions,
        reasons,
        input_schemas,
        servers,
    }))
}

fn option_refusal(member: &str, message: &str, fix: &str) -> Refusal {
    Refusal {
        code: OPTIONS_INVALID_CODE.to_owned(),
        message: message.to_owned(),
        fix: fix.to_owned(),
        operation: None,
        member: Some(member.to_owned()),
        docs: None,
    }
}

fn refused_with(refusals: Vec<Refusal>) -> ParsedEmitterOptions {
    ParsedEmitterOptions::Refused(refusals)
}

/// How a message names a refused value: a string quoted and bounded, any other value by its kind.
fn option_value_text(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => format!("'{}'", diagnostic_inert(&bounded_unknown_text(text))),
        JsonValue::Null => "Null".to_owned(),
        JsonValue::Array(_) => "An array".to_owned(),
        JsonValue::Object(_) => "An object".to_owned(),
        JsonValue::Bool(_) => format!("The boolean {}", js_text_of(Some(value))),
        JsonValue::Number(_) => format!("The number {}", js_text_of(Some(value))),
    }
}

fn parse_extensions(raw: Option<&JsonValue>, refusals: &mut Vec<Refusal>) -> ExtensionSelection {
    let Some(raw_value) = raw else {
        return ExtensionSelection::All;
    };

    if matches!(raw_value, JsonValue::String(text) if text == ALL_EXTENSIONS) {
        return ExtensionSelection::All;
    }

    if matches!(raw_value, JsonValue::String(text) if text == NO_EXTENSIONS) {
        return ExtensionSelection::None;
    }

    let JsonValue::Array(items) = raw_value else {
        refusals.push(option_refusal(
            "/extensions",
            "'extensions' must be 'all', 'none' or a list of extension names.",
            "Write 'all', 'none' or a list such as [access, paging].",
        ));

        return ExtensionSelection::All;
    };
    let mut names = Vec::new();

    for (index, item) in items.iter().enumerate() {
        let known = match item {
            JsonValue::String(text) => ExtensionName::from_text(text),
            _ => None,
        };

        if let Some(name) = known {
            if !names.contains(&name) {
                names.push(name);
            }

            continue;
        }

        let known_names: Vec<&str> = ExtensionName::ALL
            .iter()
            .map(|name| name.as_str())
            .collect();

        refusals.push(option_refusal(
            &format!("/extensions/{index}"),
            &format!(
                "{} is not an x-seampact extension name.",
                option_value_text(item)
            ),
            &format!(
                "Use a name after 'x-seampact-', one of {}.",
                known_names.join(", ")
            ),
        ));
    }

    ExtensionSelection::Named(names)
}

fn parse_choice<Choice: Copy>(
    raw: Option<&JsonValue>,
    option: &str,
    values: &[(&str, Choice)],
    default_value: Choice,
    refusals: &mut Vec<Refusal>,
) -> Choice {
    let Some(raw_value) = raw else {
        return default_value;
    };

    if let JsonValue::String(text) = raw_value
        && let Some((_, choice)) = values.iter().find(|(name, _)| name == text)
    {
        return *choice;
    }

    let names: Vec<&str> = values.iter().map(|(name, _)| *name).collect();

    refusals.push(option_refusal(
        &format!("/{option}"),
        &format!(
            "{} is not a value of '{option}'.",
            option_value_text(raw_value)
        ),
        &format!("Use one of {}.", names.join(", ")),
    ));

    default_value
}

fn parse_servers(raw: Option<&JsonValue>, refusals: &mut Vec<Refusal>) -> Vec<ServerOption> {
    let Some(raw_value) = raw else {
        return Vec::new();
    };
    let JsonValue::Array(items) = raw_value else {
        refusals.push(option_refusal(
            "/servers",
            "'servers' must be a list.",
            "Write a list of { url, description }.",
        ));

        return Vec::new();
    };
    let mut servers = Vec::new();

    for (index, item) in items.iter().enumerate() {
        match parse_server(item) {
            Some(server) => servers.push(server),
            None => refusals.push(option_refusal(
                &format!("/servers/{index}"),
                "A server must be { url, description? } with string values.",
                "Write the server as { url: https://api.example.com }.",
            )),
        }
    }

    servers
}

fn parse_server(raw: &JsonValue) -> Option<ServerOption> {
    let JsonValue::Object(record) = raw else {
        return None;
    };
    let Some(JsonValue::String(url)) = record.get("url") else {
        return None;
    };

    if url.is_empty() || has_other_member(record) {
        return None;
    }

    match record.get("description") {
        None => Some(ServerOption {
            url: url.clone(),
            description: None,
        }),
        Some(JsonValue::String(description)) => Some(ServerOption {
            url: url.clone(),
            description: Some(description.clone()),
        }),
        Some(_) => None,
    }
}

fn has_other_member(record: &JsonObject) -> bool {
    record
        .keys()
        .any(|key| key != "url" && key != "description")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json_value::json_of;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn refused(raw: &str) -> Result<Vec<Refusal>, Box<dyn std::error::Error>> {
        match parse_emitter_options(Some(&json_of(raw)?))? {
            ParsedEmitterOptions::Refused(refusals) => Ok(refusals),
            ParsedEmitterOptions::Parsed(options) => Err(format!("parsed: {options:?}").into()),
        }
    }

    fn messages(refusals: &[Refusal]) -> Vec<&str> {
        refusals
            .iter()
            .map(|refusal| refusal.message.as_str())
            .collect()
    }

    #[test]
    fn absent_options_are_the_defaults() -> TestResult {
        assert_eq!(
            parse_emitter_options(None)?,
            ParsedEmitterOptions::Parsed(EmitterOptions::default())
        );

        Ok(())
    }

    #[test]
    fn extension_names_round_trip_and_name_their_schema_file() {
        for name in ExtensionName::ALL {
            assert_eq!(ExtensionName::from_text(name.as_str()), Some(name));
        }

        assert_eq!(ExtensionName::from_text("Access"), None);
        assert_eq!(
            ExtensionName::Access.schema_path(),
            "schemas/extensions/access.schema.json"
        );
    }

    #[test]
    fn a_listed_extension_is_kept_once_and_an_unknown_one_is_refused_by_index() -> TestResult {
        let parsed = parse_emitter_options(Some(&json_of(
            r#"{"extensions": ["access", "access", "paging"]}"#,
        )?))?;

        assert_eq!(
            parsed,
            ParsedEmitterOptions::Parsed(EmitterOptions {
                extensions: ExtensionSelection::Named(vec![
                    ExtensionName::Access,
                    ExtensionName::Paging
                ]),
                ..EmitterOptions::default()
            })
        );

        let refusals = refused(r#"{"extensions": ["access", 3, "nope"]}"#)?;
        let members: Vec<Option<&str>> = refusals
            .iter()
            .map(|refusal| refusal.member.as_deref())
            .collect();

        assert_eq!(members, [Some("/extensions/1"), Some("/extensions/2")]);
        assert_eq!(
            messages(&refusals),
            [
                "The number 3 is not an x-seampact extension name.",
                "'nope' is not an x-seampact extension name."
            ]
        );

        Ok(())
    }

    #[test]
    fn a_refused_value_is_shown_bounded_in_utf16_units_or_by_its_kind() -> TestResult {
        let long = "\u{1F600}".repeat(40);
        let refusals = refused(&format!(r#"{{"reasons": "{long}"}}"#))?;
        let expected = format!(
            "'{}...' is not a value of 'reasons'.",
            "\u{1F600}".repeat(32)
        );

        assert_eq!(messages(&refusals), [expected.as_str()]);

        for (raw, text) in [
            (r#"{"reasons": null}"#, "Null is not a value of 'reasons'."),
            (
                r#"{"reasons": []}"#,
                "An array is not a value of 'reasons'.",
            ),
            (
                r#"{"reasons": {}}"#,
                "An object is not a value of 'reasons'.",
            ),
            (
                r#"{"reasons": true}"#,
                "The boolean true is not a value of 'reasons'.",
            ),
            (
                r#"{"reasons": 1e21}"#,
                "The number 1e+21 is not a value of 'reasons'.",
            ),
            (
                r#"{"reasons": -0}"#,
                "The number 0 is not a value of 'reasons'.",
            ),
        ] {
            assert_eq!(messages(&refused(raw)?), [text], "options {raw}");
        }

        Ok(())
    }

    #[test]
    fn a_server_is_a_url_with_an_optional_description_and_nothing_else() -> TestResult {
        for raw in [
            r#"{"servers": [{"url": ""}]}"#,
            r#"{"servers": [{"url": "https://a", "name": "x"}]}"#,
            r#"{"servers": [{"url": "https://a", "description": null}]}"#,
            r#"{"servers": [{"description": "d"}]}"#,
            r#"{"servers": ["https://a"]}"#,
        ] {
            let refusals = refused(raw)?;

            assert_eq!(
                messages(&refusals),
                ["A server must be { url, description? } with string values."],
                "options {raw}"
            );
            assert_eq!(
                refusals
                    .first()
                    .and_then(|refusal| refusal.member.as_deref()),
                Some("/servers/0")
            );
        }

        assert_eq!(
            messages(&refused(r#"{"servers": {}}"#)?),
            ["'servers' must be a list."]
        );

        Ok(())
    }

    #[test]
    fn options_that_are_no_mapping_or_name_an_unknown_member_are_refused() -> TestResult {
        let refusals = refused("[]")?;

        assert_eq!(
            messages(&refusals),
            ["The OpenAPI options must be a mapping."]
        );
        assert_eq!(
            refusals
                .first()
                .and_then(|refusal| refusal.member.as_deref()),
            Some("")
        );
        assert_eq!(
            messages(&refused(r#"{"reason": "omit"}"#)?),
            ["'reason' is not an OpenAPI option."]
        );

        Ok(())
    }

    #[test]
    fn a_refused_string_is_inert_in_the_message() -> TestResult {
        let refusals = refused(r#"{"reasons": "a\u001b[2J\u202eb"}"#)?;

        assert_eq!(
            messages(&refusals),
            ["'a\\u001B[2J\\u202Eb' is not a value of 'reasons'."]
        );

        Ok(())
    }
}
