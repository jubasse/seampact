//! A config value checked against the app or root config schema.

use std::collections::HashSet;
use std::sync::OnceLock;

use jsonschema::{Draft, Validator};
use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, from_json_value};

use crate::CliProblem;
use crate::config_position::ParsedConfig;
use crate::key_path::format_key_path;
use crate::key_problem::KeyProblem;
use crate::schema_failure::schema_failures;
use crate::schema_problems::schema_error_problems;

const APP_SCHEMA_TEXT: &str =
    include_str!("../../../packages/core/spec/schemas/config/app.schema.json");
const ROOT_SCHEMA_TEXT: &str =
    include_str!("../../../packages/core/spec/schemas/config/root.schema.json");

static APP_VALIDATOR: OnceLock<Result<Validator, InternalError>> = OnceLock::new();
static ROOT_VALIDATOR: OnceLock<Result<Validator, InternalError>> = OnceLock::new();

/// The schema a config is checked against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigSchema {
    /// `app.schema.json`.
    App,
    /// `root.schema.json`.
    Root,
}

/// A config checked: valid, or the problems that stop it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ValidateConfigOutcome {
    /// The value satisfies the schema and no key problem was found.
    Valid,
    /// The key problems then the schema problems.
    Refused(Vec<CliProblem>),
}

/// Checks `value` against `schema`; `key_problems` come first and hide the schema failures at their paths.
pub(crate) fn validate_config(
    parsed: &ParsedConfig,
    value: &JsonValue,
    schema: ConfigSchema,
    key_problems: Vec<KeyProblem>,
) -> Result<ValidateConfigOutcome, InternalError> {
    let validator = validator_of(schema)?;
    let instance: serde_json::Value = from_json_value(value)
        .map_err(|error| InternalError::new(format!("a config value does not convert: {error}")))?;
    let is_valid = validator.is_valid(&instance);
    let failures = schema_failures(validator, &instance);
    let reported_paths: HashSet<String> = key_problems
        .iter()
        .map(|key_problem| format_key_path(&key_problem.path))
        .collect();
    let schema_problems = schema_error_problems(parsed, &failures, &reported_paths)?;
    let mut problems: Vec<CliProblem> = key_problems
        .into_iter()
        .map(|key_problem| key_problem.problem)
        .collect();

    problems.extend(schema_problems);

    if !problems.is_empty() || !is_valid {
        return Ok(ValidateConfigOutcome::Refused(problems));
    }

    Ok(ValidateConfigOutcome::Valid)
}

fn validator_of(schema: ConfigSchema) -> Result<&'static Validator, InternalError> {
    let (cell, text) = match schema {
        ConfigSchema::App => (&APP_VALIDATOR, APP_SCHEMA_TEXT),
        ConfigSchema::Root => (&ROOT_VALIDATOR, ROOT_SCHEMA_TEXT),
    };

    cell.get_or_init(|| compiled(text))
        .as_ref()
        .map_err(Clone::clone)
}

fn compiled(text: &str) -> Result<Validator, InternalError> {
    let document: serde_json::Value = serde_json::from_str(text)
        .map_err(|error| InternalError::new(format!("a config schema is not JSON: {error}")))?;

    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .build(&document)
        .map_err(|error| InternalError::new(format!("a config schema does not compile: {error}")))
}
