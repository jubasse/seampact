//! One `seampact.config.yaml` read with the loader's YAML rules: size, syntax and reserved keys.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;

use camino::Utf8Path;
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use seampact_load::yaml::{YamlKind, YamlNode, YamlProblem, parse_yaml};
use seampact_load::{ResolvedScalar, is_reserved_key};
use seampact_span::{SourceFiles, TextSize};

use crate::config_kind::ConfigKind;
use crate::config_position::ParsedConfig;
use crate::config_value::config_value;
use crate::{CliConfigError, CliProblem};

/// The config is trusted, but a stray huge file is refused before it is parsed.
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

const YAML_SYNTAX_CODE: &str = "config.yaml.syntax";
const YAML_SYNTAX_FIX: &str = "Correct the YAML at that position.";
const DUPLICATE_KEY_MESSAGE: &str = "Map keys must be unique";
const SECOND_DOCUMENT_MESSAGE: &str =
    "Source contains multiple documents; please use YAML.parseAllDocuments()";
const TOO_DEEP_MESSAGE: &str = "Flow collections nest too deeply";

/// A config file parsed with its value, or the problems that stop it.
#[derive(Debug, Clone)]
pub(crate) enum ParseConfigOutcome {
    /// The file parsed.
    Parsed {
        parsed: Box<ParsedConfig>,
        value: JsonValue,
    },
    /// The file is missing, too large, or has a syntax or reserved-key problem.
    Refused(Vec<CliProblem>),
}

/// Reads and parses `file`, named `display_name` in problems.
pub(crate) fn parse_config_file(
    file: &Utf8Path,
    display_name: &str,
    kind: ConfigKind,
) -> Result<ParseConfigOutcome, CliConfigError> {
    let text = match read_config_text(file, display_name, kind)? {
        ConfigText::Text(text) => text,
        ConfigText::Refused(problem) => return Ok(ParseConfigOutcome::Refused(vec![problem])),
    };
    let mut files = SourceFiles::new();
    let source = files
        .add(display_name, &text)
        .map_err(|error| InternalError::new(error.to_string()))?;
    let normalised = files
        .get(source)
        .ok_or_else(|| InternalError::new("a source file just added is missing"))?
        .text()
        .to_owned();
    let document = parse_yaml(source, &normalised)?;
    let parsed = ParsedConfig {
        document,
        files,
        file: source,
        display_name: display_name.to_owned(),
        kind,
    };
    let syntax_problems = yaml_problems(&parsed)?;

    if !syntax_problems.is_empty() {
        return Ok(ParseConfigOutcome::Refused(syntax_problems));
    }

    let reserved_problems = reserved_key_problems(&parsed)?;

    if !reserved_problems.is_empty() {
        return Ok(ParseConfigOutcome::Refused(reserved_problems));
    }

    Ok(parsed_value(parsed))
}

fn parsed_value(parsed: ParsedConfig) -> ParseConfigOutcome {
    match config_value(parsed.document.root.as_ref()) {
        Ok(value) => ParseConfigOutcome::Parsed {
            parsed: Box::new(parsed),
            value,
        },
        Err(error) => ParseConfigOutcome::Refused(vec![CliProblem::at(
            YAML_SYNTAX_CODE,
            yaml_error_sentence(&error.message()),
            YAML_SYNTAX_FIX,
            parsed.display_name.clone(),
        )]),
    }
}

enum ConfigText {
    Text(String),
    Refused(CliProblem),
}

fn read_config_text(
    file: &Utf8Path,
    display_name: &str,
    kind: ConfigKind,
) -> Result<ConfigText, CliConfigError> {
    let Some(size) = file_size(file)? else {
        let fix = match kind {
            ConfigKind::App => {
                "Create `seampact.config.yaml` in the app's directory, or pass its path with `--config`."
            }
            ConfigKind::Root => {
                "Pass the path of the monorepo root's `seampact.config.yaml`, the one holding `apps`."
            }
        };

        return Ok(ConfigText::Refused(CliProblem::unlocated(
            "config.file.missing",
            format!("No {} at {display_name}.", kind.as_str()),
            fix,
        )));
    };

    if size > MAX_CONFIG_BYTES {
        return Ok(ConfigText::Refused(CliProblem::unlocated(
            "config.file.too-large",
            format!(
                "{display_name} holds {size} bytes, over the {MAX_CONFIG_BYTES} bytes {} may hold.",
                kind.articled()
            ),
            &format!("Pass the path of the {} itself.", kind.as_str()),
        )));
    }

    let bytes = fs::read(file).map_err(|error| io_error(file, &error))?;

    Ok(ConfigText::Text(
        String::from_utf8_lossy(&bytes).into_owned(),
    ))
}

/// The size of the regular file `file`; `None` when it is missing or not a file.
pub(crate) fn file_size(file: &Utf8Path) -> Result<Option<u64>, CliConfigError> {
    match fs::metadata(file) {
        Ok(stats) if stats.is_file() => Ok(Some(stats.len())),
        Ok(_) => Ok(None),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            Ok(None)
        }
        Err(error) => Err(io_error(file, &error)),
    }
}

pub(crate) fn io_error(file: &Utf8Path, error: &std::io::Error) -> CliConfigError {
    CliConfigError::Io {
        path: file.to_string(),
        message: error.to_string(),
    }
}

fn yaml_problems(parsed: &ParsedConfig) -> Result<Vec<CliProblem>, InternalError> {
    let mut errors: Vec<(String, TextSize)> = Vec::new();

    match &parsed.document.problem {
        Some(YamlProblem::Syntax { info, at }) => errors.push((info.clone(), at.range.start())),
        Some(YamlProblem::TooDeep { at }) => {
            errors.push((TOO_DEEP_MESSAGE.to_owned(), at.range.start()));
        }
        Some(YamlProblem::SecondDocument { at }) => {
            errors.push((SECOND_DOCUMENT_MESSAGE.to_owned(), at.range.start()));
        }
        None => {
            if let Some(root) = &parsed.document.root {
                collect_duplicate_keys(root, &mut errors);
            }
        }
    }

    errors
        .into_iter()
        .map(|(message, offset)| {
            let at = parsed.position_text(Some(offset))?;

            Ok(CliProblem::at(
                YAML_SYNTAX_CODE,
                yaml_error_sentence(&message),
                YAML_SYNTAX_FIX,
                format!("{}{at}", parsed.display_name),
            ))
        })
        .collect()
}

fn collect_duplicate_keys(node: &YamlNode, errors: &mut Vec<(String, TextSize)>) {
    match &node.kind {
        YamlKind::Mapping(pairs) => {
            let mut seen: Vec<ResolvedScalar> = Vec::new();

            for pair in pairs {
                if let Some(key) = pair.key.resolved_scalar() {
                    if seen.contains(&key) {
                        errors.push((
                            DUPLICATE_KEY_MESSAGE.to_owned(),
                            pair.key.span.range.start(),
                        ));
                    }

                    seen.push(key);
                }

                collect_duplicate_keys(&pair.key, errors);

                if let Some(value) = &pair.value {
                    collect_duplicate_keys(value, errors);
                }
            }
        }
        YamlKind::Sequence(items) => {
            for item in items {
                collect_duplicate_keys(item, errors);
            }
        }
        YamlKind::Scalar { .. } | YamlKind::Alias(_) => {}
    }
}

/// The first line of a parser message without its ` at line N, column M` tail, and a period.
fn yaml_error_sentence(message: &str) -> String {
    let first_line = message.split('\n').next().unwrap_or(message);

    format!("{}.", without_line_column_tail(first_line))
}

// The regular expression / at line \d+, column \d+:?$/ with `\d` ASCII only.
fn without_line_column_tail(line: &str) -> &str {
    let candidate = line.strip_suffix(':').unwrap_or(line);

    for text in [candidate, line] {
        if let Some((head, tail)) = text.rsplit_once(" at line ")
            && let Some((line_number, column)) = tail.split_once(", column ")
            && is_ascii_digits(line_number)
            && is_ascii_digits(column)
            && !head.is_empty()
        {
            return head;
        }
    }

    line
}

fn is_ascii_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn reserved_key_problems(parsed: &ParsedConfig) -> Result<Vec<CliProblem>, InternalError> {
    let mut problems = Vec::new();
    let mut anchored: HashMap<&str, &YamlNode> = HashMap::new();

    if let Some(root) = &parsed.document.root {
        visit_reserved_keys(root, parsed, &mut anchored, &mut problems)?;
    }

    Ok(problems)
}

fn visit_reserved_keys<'tree>(
    node: &'tree YamlNode,
    parsed: &ParsedConfig,
    anchored: &mut HashMap<&'tree str, &'tree YamlNode>,
    problems: &mut Vec<CliProblem>,
) -> Result<(), InternalError> {
    if let Some(anchor) = &node.anchor {
        anchored.insert(anchor.as_str(), node);
    }

    match &node.kind {
        YamlKind::Mapping(pairs) => {
            for pair in pairs {
                let key = match &pair.key.kind {
                    YamlKind::Alias(name) => anchored.get(name.as_str()).copied(),
                    YamlKind::Scalar { .. } | YamlKind::Mapping(_) | YamlKind::Sequence(_) => {
                        Some(&pair.key)
                    }
                };

                if let Some(ResolvedScalar::String(text)) = key.and_then(YamlNode::resolved_scalar)
                    && is_reserved_key(&text)
                {
                    let at = parsed.position_text(Some(pair.key.span.range.start()))?;

                    problems.push(CliProblem::at(
                        "config.key.reserved",
                        format!(
                            "The key '{text}' is reserved: it would reach a JavaScript object's prototype."
                        ),
                        "Rename or remove the key.",
                        format!("{}{at}", parsed.display_name),
                    ));
                }

                visit_reserved_keys(&pair.key, parsed, anchored, problems)?;

                if let Some(value) = &pair.value {
                    visit_reserved_keys(value, parsed, anchored, problems)?;
                }
            }
        }
        YamlKind::Sequence(items) => {
            for item in items {
                visit_reserved_keys(item, parsed, anchored, problems)?;
            }
        }
        YamlKind::Scalar { .. } | YamlKind::Alias(_) => {}
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_line_and_column_tail_is_stripped_only_with_ascii_digits() {
        assert_eq!(
            yaml_error_sentence("Nested mappings are not allowed at line 3, column 5:\n\n> x"),
            "Nested mappings are not allowed."
        );
        assert_eq!(
            yaml_error_sentence("Bad at line \u{661}, column 2"),
            "Bad at line \u{661}, column 2."
        );
        assert_eq!(yaml_error_sentence("Plain message"), "Plain message.");
    }
}
