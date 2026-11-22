//! The problems a config schema failure becomes: one sentence and one fix per failure.

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_js::{FiniteNumber, js_number_of_text};

use crate::CliProblem;
use crate::config_position::ParsedConfig;
use crate::key_path::{KeyPath, KeyPathSegment, format_key_path};
use crate::schema_failure::{SchemaFailure, SchemaKeyword};

const FRAMEWORK_ROUTE_PATH_RULE: &str = "The key 'path' of a framework route is '/' then segments, each '*', '**', or text without '?', '{' or '}' holding at most two '*'.";
const FRAMEWORK_ROUTE_SWITCH: &str = "frameworkRoutes";
const MOUNT_RULE: &str = "The key 'mount' is '/' then segments of ASCII letters, digits and '-._~!$&'()+,;=@:', with no trailing '/', no '*', no '.' or '..' segment and no segment starting with ':'.";
const TARGET_USE_RULE: &str = "The key 'use' names a PyPI distribution as the lowercase prefix 'pypi:' then its PEP 503 normalised name (lowercase ASCII letters and digits, runs joined by one '-'); the prefix 'pypi:' in any case is reserved for this form, so the Maven group 'pypi' is never a coordinate.";
const TARGET_USE_FIX: &str = "Write the prefix as 'pypi:' then the distribution's normalised name, such as 'pypi:seampact-fastapi' (ADR 0011 'The app config').";
const ALLOW_UNTESTED_RULE: &str = "An `allowUntested` item is '<framework>@<major>', or '<framework>@0.<minor>' for a 0.x framework; a major of 1 or more takes no minor.";
const ALLOW_UNTESTED_FIX: &str = "Write '<framework>@<major>' (such as 'spring-boot@4', not 'spring-boot@4.1'), or '<framework>@0.<minor>' for a 0.x framework (such as 'fastapi@0.162').";
const SCHEMA_FIX: &str =
    "Correct the value as the config schema states (ADR 0011 'The app config').";
const SCHEMA_CODE: &str = "config.schema";
const BOOT_CHECK_ARTEFACT: &str = "bootCheck";
const STRICT_FRAMEWORK_ROUTE_CHECK: &str = "strict";
const CONFIG_DOCS_SECTION: &str = "(ADR 0011 'The app config')";

/// The problems of the schema failures, without the ones a `oneOf` repeats or a key problem already reported.
pub(crate) fn schema_error_problems(
    parsed: &ParsedConfig,
    failures: &[SchemaFailure],
    reported_paths: &HashSet<String>,
) -> Result<Vec<CliProblem>, InternalError> {
    let one_of_paths: HashSet<&str> = failures
        .iter()
        .filter(|failure| failure.keyword.is_one_of())
        .map(|failure| failure.instance_path.as_str())
        .collect();
    let mut problems = Vec::new();

    for failure in failures {
        let repeats_one_of = !failure.keyword.is_one_of()
            && failure.in_one_of_branch
            && one_of_paths.contains(failure.instance_path.as_str());
        let holds_deeper_one_of =
            failure.keyword.is_one_of() && has_deeper_path(&failure.instance_path, &one_of_paths);

        if repeats_one_of || holds_deeper_one_of {
            continue;
        }

        let (problem, key_path) = schema_error_problem(parsed, failure)?;

        if is_at_or_under(&key_path, reported_paths) {
            continue;
        }

        if failure.keyword.is_one_of() && holds_reported_path(&key_path, reported_paths) {
            continue;
        }

        problems.push(problem);
    }

    Ok(problems)
}

fn holds_reported_path(key_path: &str, reported_paths: &HashSet<String>) -> bool {
    reported_paths.iter().any(|reported| {
        reported.starts_with(&format!("{key_path}."))
            || reported.starts_with(&format!("{key_path}["))
    })
}

fn has_deeper_path(instance_path: &str, paths: &HashSet<&str>) -> bool {
    paths
        .iter()
        .any(|path| path.starts_with(&format!("{instance_path}/")))
}

fn is_at_or_under(key_path: &str, reported_paths: &HashSet<String>) -> bool {
    reported_paths.iter().any(|reported| {
        key_path == reported
            || key_path.starts_with(&format!("{reported}."))
            || key_path.starts_with(&format!("{reported}["))
    })
}

fn schema_error_problem(
    parsed: &ParsedConfig,
    failure: &SchemaFailure,
) -> Result<(CliProblem, String), InternalError> {
    let path = instance_path_of(&failure.instance_path);
    let key_path = format_key_path(&path);
    let problem_at = |message: String, fix: &str, at: &[KeyPathSegment]| {
        Ok::<_, InternalError>(CliProblem::at(
            SCHEMA_CODE,
            message,
            fix,
            parsed.where_of(at)?,
        ))
    };

    match &failure.keyword {
        SchemaKeyword::AdditionalProperties(property) => {
            let mut with_key = path.clone();

            with_key.push(KeyPathSegment::key(property));

            let problem = problem_at(
                format!(
                    "'{property}' is not a key the {} takes here.",
                    parsed.kind.as_str()
                ),
                &format!("Remove the key, or correct its spelling {CONFIG_DOCS_SECTION}."),
                &with_key,
            )?;

            Ok((problem, format_key_path(&with_key)))
        }
        SchemaKeyword::Required(missing) => Ok((
            problem_at(
                format!("The key '{missing}' is required here."),
                &format!("Add '{missing}'."),
                &path,
            )?,
            key_path,
        )),
        SchemaKeyword::Pattern => {
            let (message, fix) = pattern_sentences(&path);

            Ok((problem_at(message, &fix, &path)?, key_path))
        }
        SchemaKeyword::OneOf => {
            let (message, fix) = one_of_sentences(&path);

            Ok((problem_at(message, &fix, &path)?, key_path))
        }
        SchemaKeyword::Other(_) => Ok((
            problem_at(format!("The value {}.", failure.message), SCHEMA_FIX, &path)?,
            key_path,
        )),
    }
}

// The sentence of a `pattern` failure: the key's own rule, else the generic one.
fn pattern_sentences(path: &[KeyPathSegment]) -> (String, String) {
    if is_framework_route_path(path) {
        return (
            FRAMEWORK_ROUTE_PATH_RULE.to_owned(),
            format!(
                "Write a route parameter as '*' and a catch-all as '**' {CONFIG_DOCS_SECTION}."
            ),
        );
    }

    if segment_from_end(path, 2) == Some("allowUntested") {
        return (
            ALLOW_UNTESTED_RULE.to_owned(),
            ALLOW_UNTESTED_FIX.to_owned(),
        );
    }

    match segment_from_end(path, 1) {
        Some("mount") => (
            MOUNT_RULE.to_owned(),
            format!(
                "Write the path prefix the api is served under, such as '/api' {CONFIG_DOCS_SECTION}."
            ),
        ),
        Some("use") => (TARGET_USE_RULE.to_owned(), TARGET_USE_FIX.to_owned()),
        _ => (String::new(), SCHEMA_FIX.to_owned()),
    }
}

// `path.at(-n)` as a mapping key; a list position is no key.
fn segment_from_end(path: &[KeyPathSegment], from_end: usize) -> Option<&str> {
    let position = path.len().checked_sub(from_end)?;

    match path.get(position)? {
        KeyPathSegment::Key(key) => Some(key),
        KeyPathSegment::Index(_) => None,
    }
}

fn is_framework_route_path(path: &[KeyPathSegment]) -> bool {
    segment_from_end(path, 1) == Some("path")
        && segment_from_end(path, 3) == Some("frameworkRoutes")
}

fn one_of_sentences(path: &[KeyPathSegment]) -> (String, String) {
    let first = path.first().and_then(|segment| match segment {
        KeyPathSegment::Key(key) => Some(key.as_str()),
        KeyPathSegment::Index(_) => None,
    });

    if first == Some("sources") {
        return (
            "A source takes one form: 'path', 'package' with 'version', 'release', 'git' or 'maven'; 'integrity' goes with a bundle form only.".to_owned(),
            format!("Keep the keys of one form {CONFIG_DOCS_SECTION}."),
        );
    }

    if segment_from_end(path, 1) == Some(FRAMEWORK_ROUTE_SWITCH)
        && segment_from_end(path, 2) == Some(BOOT_CHECK_ARTEFACT)
    {
        return (
            format!(
                "'bootCheck.frameworkRoutes' is true, false or '{STRICT_FRAMEWORK_ROUTE_CHECK}'."
            ),
            format!(
                "Write true to check the app routes under the contract's base paths, '{STRICT_FRAMEWORK_ROUTE_CHECK}' to check every app route, or false to switch the check off."
            ),
        );
    }

    if segment_from_end(path, 1) == Some(BOOT_CHECK_ARTEFACT) {
        return (
            "'bootCheck' is true, false or '{ frameworkRoutes }'.".to_owned(),
            "Switch the boot check with a boolean, or its framework-route check alone with '{ frameworkRoutes: false }'.".to_owned(),
        );
    }

    if first == Some("targets") {
        return (
            "A target entry takes exactly one of 'api' and 'apis'.".to_owned(),
            "Name one api with 'api', or several with 'apis'.".to_owned(),
        );
    }

    if segment_from_end(path, 1) == Some("extensions") {
        return (
            "'extensions' is 'all', 'none' or a list of extension names.".to_owned(),
            "Write 'all', 'none' or a list such as [access, paging].".to_owned(),
        );
    }

    if path.len() == 1 {
        return (
            "'openapi' is 'none' or a mapping from api names to their documents.".to_owned(),
            "Write 'openapi: none', or map each api to its document's path.".to_owned(),
        );
    }

    (
        "An api's documents are a path, '{ path, ...options }', or a mapping from each document id to one of those.".to_owned(),
        format!(
            "Write the path of the api's one document, or map each of its documents to a path {CONFIG_DOCS_SECTION}."
        ),
    )
}

/// A JSON Pointer as a key path: a digit-only segment is a number, as JavaScript's `Number` reads it.
fn instance_path_of(instance_path: &str) -> KeyPath {
    let Some(pointer) = instance_path.strip_prefix('/') else {
        return Vec::new();
    };

    pointer
        .split('/')
        .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
        .map(|segment| {
            let is_digits =
                !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit());

            match FiniteNumber::new(js_number_of_text(&segment)) {
                Some(number) if is_digits => KeyPathSegment::Index(number),
                _ => KeyPathSegment::Key(segment),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pointer_unescapes_in_javascript_order_and_reads_digits_as_numbers() {
        let path = instance_path_of("/a~01/targets/12/\u{661}");

        assert_eq!(
            path,
            vec![
                KeyPathSegment::key("a~1"),
                KeyPathSegment::key("targets"),
                KeyPathSegment::Index(FiniteNumber::from_i64(12)),
                KeyPathSegment::key("\u{661}"),
            ]
        );
        assert_eq!(instance_path_of(""), []);
    }
}
