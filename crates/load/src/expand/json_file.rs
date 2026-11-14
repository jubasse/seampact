//! A `$file` JSON file, read once per real path and made safe for the loader's tree.

use std::rc::Rc;

use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue};
use seampact_span::Span;
use serde_json::error::Category;

use super::{Expander, JsonFile};
use crate::budget::utf16_length;
use crate::json::is_reserved_key;
use crate::limits::LOAD_MAX_DEPTH;
use crate::report::LoadRule;

/// What V8 says of a JSON text that ends early (a fixture holds it).
const UNEXPECTED_END: &str = "Unexpected end of JSON input";

/// The nesting past which no use of a file could pass: the walk counts one level more than the
/// limit, and a use adds its own depth to it.
const MAX_PARSED_NESTING: usize = LOAD_MAX_DEPTH + 1;

/// What one use of a JSON file costs, counted as the file is made safe.
#[derive(Debug, Default)]
struct JsonCost {
    nodes: u64,
    text: u64,
    depth: usize,
}

impl Expander<'_, '_> {
    /// A JSON file parsed once per real path and turned into the loader's own tree (no reserved
    /// key, reported at the first site that reads it), with what one use costs: its nodes, its
    /// characters and its depth. Nothing deeper than the depth limit is walked.
    pub(super) fn json_file(
        &mut self,
        path: &str,
        real: &str,
        at: Span,
    ) -> Result<Rc<JsonFile>, InternalError> {
        if let Some(hit) = self.json_files.get(real) {
            return Ok(Rc::clone(hit));
        }

        let text = match self.store.raw_text(self.reporter, path)? {
            Some(file_id) => self
                .store
                .text_of(file_id)
                .ok_or_else(|| {
                    InternalError::new(format!("file '{path}' is in the table with no text"))
                })?
                .to_owned(),
            None => String::new(),
        };
        let result = match parse_json_text(&text) {
            Ok(Some(parsed)) => {
                let mut cost = JsonCost::default();
                let value = self.json_safe(parsed, path, at, 0, &mut cost)?;

                JsonFile::Valid {
                    value,
                    nodes: cost.nodes,
                    text: cost.text,
                    depth: cost.depth,
                }
            }
            Ok(None) => JsonFile::TooDeep,
            Err(error) => JsonFile::Invalid { error },
        };
        let result = Rc::new(result);

        self.json_files.insert(real.to_owned(), Rc::clone(&result));

        Ok(result)
    }

    fn json_safe(
        &mut self,
        value: JsonValue,
        path: &str,
        at: Span,
        depth: usize,
        cost: &mut JsonCost,
    ) -> Result<JsonValue, InternalError> {
        cost.nodes += 1;
        cost.depth = cost.depth.max(depth);

        // Refused per use, by depth.
        if depth > LOAD_MAX_DEPTH {
            return Ok(JsonValue::Null);
        }

        match value {
            JsonValue::String(text) => {
                cost.text += utf16_length(&text);

                Ok(JsonValue::String(text))
            }
            JsonValue::Array(items) => {
                let mut safe = Vec::with_capacity(items.len());

                for item in items {
                    safe.push(self.json_safe(item, path, at, depth + 1, cost)?);
                }

                Ok(JsonValue::Array(safe))
            }
            JsonValue::Object(members) => {
                let mut safe = JsonObject::new();

                for (key, member) in members {
                    if is_reserved_key(&key) {
                        self.report(
                            LoadRule::ReservedKey,
                            format!(
                                "'{path}' holds the key '{key}', which names a property every JavaScript object inherits"
                            ),
                            "rename the key in the JSON file",
                            at,
                        )?;

                        continue;
                    }

                    cost.text += utf16_length(&key);
                    safe.insert(key, self.json_safe(member, path, at, depth + 1, cost)?);
                }

                Ok(JsonValue::Object(safe))
            }
            other @ (JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_)) => Ok(other),
        }
    }
}

/// The value of a JSON text for a `$file` use, `Ok(None)` when it nests deeper than any use could
/// admit (it is not parsed), or the parser's message.
fn parse_json_text(text: &str) -> Result<Option<JsonValue>, String> {
    let Some(parsed) = parse_json_document(text, MAX_PARSED_NESTING)? else {
        return Ok(None);
    };

    JsonValue::try_from(parsed)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// The value of a JSON text as the parser reads it (a number beyond `f64` stays a token),
/// `Ok(None)` when it nests deeper than `max_nesting` (it is not parsed), or the parser's message.
///
/// The nesting is scanned first so that the parser, whose own recursion limit is off, never
/// meets more than `max_nesting` levels.
pub(crate) fn parse_json_document(
    text: &str,
    max_nesting: usize,
) -> Result<Option<serde_json::Value>, String> {
    if bracket_depth_of(text) > max_nesting {
        return Ok(None);
    }

    let mut deserializer = serde_json::Deserializer::from_str(text);

    deserializer.disable_recursion_limit();

    let mut values = deserializer.into_iter::<serde_json::Value>();
    let first = match values.next() {
        Some(Ok(value)) => value,
        Some(Err(error)) => return Err(parser_message(&error)),
        None => return Err(UNEXPECTED_END.to_owned()),
    };

    match values.next() {
        None => {}
        Some(Ok(_)) => return Err("Unexpected non-whitespace character after JSON".to_owned()),
        Some(Err(error)) => return Err(parser_message(&error)),
    }

    Ok(Some(first))
}

fn parser_message(error: &serde_json::Error) -> String {
    if error.classify() == Category::Eof {
        return UNEXPECTED_END.to_owned();
    }

    error.to_string()
}

/// The deepest nesting of `[` and `{` outside strings.
fn bracket_depth_of(text: &str) -> usize {
    let mut depth = 0_usize;
    let mut deepest = 0_usize;
    let mut in_string = false;
    let mut escaped = false;

    for byte in text.bytes() {
        if in_string {
            match (escaped, byte) {
                (true, _) => escaped = false,
                (false, b'\\') => escaped = true,
                (false, b'"') => in_string = false,
                _ => {}
            }

            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'[' | b'{' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }

    deepest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_nesting_counts_brackets_outside_strings_only() {
        assert_eq!(bracket_depth_of(""), 0);
        assert_eq!(bracket_depth_of("[[{}]]"), 3);
        assert_eq!(bracket_depth_of(r#"["[[[", "\"[[", {"a": "}"}]"#), 2);
        assert_eq!(bracket_depth_of("]]]["), 1);
    }

    #[test]
    fn a_text_nested_past_the_limit_is_not_parsed() {
        let at_limit = format!(
            "{}{}",
            "[".repeat(MAX_PARSED_NESTING),
            "]".repeat(MAX_PARSED_NESTING)
        );
        let past_limit = format!("[{at_limit}]");

        assert!(matches!(parse_json_text(&at_limit), Ok(Some(_))));
        assert_eq!(parse_json_text(&past_limit), Ok(None));
    }

    #[test]
    fn the_parser_messages_are_v8s_where_a_fixture_holds_them() {
        assert_eq!(parse_json_text(""), Err(UNEXPECTED_END.to_owned()));
        assert_eq!(parse_json_text("  "), Err(UNEXPECTED_END.to_owned()));
        assert_eq!(parse_json_text("[1,"), Err(UNEXPECTED_END.to_owned()));
        assert!(parse_json_text("[1] x").is_err());
        assert!(parse_json_text("1e400").is_err());
    }
}
