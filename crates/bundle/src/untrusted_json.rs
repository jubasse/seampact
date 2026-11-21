//! JSON from the network: refused for a byte order mark, a parse error or a reserved key.

use std::collections::HashSet;

use seampact_diagnostics::{InternalError, quote_text};
use seampact_js::json_parse_error_message;
use seampact_json::JsonValue;
use seampact_load::is_reserved_key;
use seampact_pipeline::pointer_below as pipeline_pointer_below;

const BYTE_ORDER_MARK: char = '\u{feff}';

/// The parse of an untrusted JSON text, or why it is refused.
#[derive(Debug, Clone, PartialEq)]
pub enum UntrustedJson {
    /// The text parsed and holds no reserved key.
    Parsed(JsonValue),
    /// The text is refused; the problem reads after the file's name.
    Refused {
        /// What is wrong.
        problem: String,
    },
}

fn refused(problem: String) -> UntrustedJson {
    UntrustedJson::Refused { problem }
}

/// The parsed text, or why it is refused: a byte order mark, not JSON, or a reserved key with its
/// JSON Pointer.
///
/// A document nested deeper than the parser's recursion limit is refused as not JSON, where
/// `JSON.parse` would read it.
#[must_use]
pub fn parse_untrusted_json(text: &str) -> UntrustedJson {
    if text.starts_with(BYTE_ORDER_MARK) {
        return refused("starts with a byte order mark (U+FEFF)".to_owned());
    }

    let value = match serde_json::from_str::<JsonValue>(text) {
        Ok(value) => value,
        Err(error) => {
            let message = json_parse_error_message(text).unwrap_or_else(|| error.to_string());

            return refused(format!("is not JSON ({})", quote_text(&message)));
        }
    };

    match reserved_key_pointer(&value) {
        Some(pointer) => refused(format!(
            "holds the reserved key at {}",
            quote_text(&pointer)
        )),
        None => UntrustedJson::Parsed(value),
    }
}

fn pointer_below(pointer: &str, key: &str) -> String {
    pipeline_pointer_below(pointer, &[key])
}

/// The pointer of the first reserved key, walking the document with a stack so that a deep one
/// does not exhaust the call stack.
fn reserved_key_pointer(root: &JsonValue) -> Option<String> {
    let mut pending: Vec<(&JsonValue, String)> = vec![(root, String::new())];

    while let Some((value, pointer)) = pending.pop() {
        match value {
            JsonValue::Object(members) => {
                for (key, member) in members {
                    let at = pointer_below(&pointer, key);

                    if is_reserved_key(key) {
                        return Some(at);
                    }

                    pending.push((member, at));
                }
            }
            JsonValue::Array(items) => {
                for (index, member) in items.iter().enumerate() {
                    pending.push((member, pointer_below(&pointer, &index.to_string())));
                }
            }
            JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {}
        }
    }

    None
}

/// An open object or array of the scan.
struct ScanFrame {
    pointer: String,
    /// The keys seen so far; `None` in an array.
    keys: Option<HashSet<String>>,
    key: Option<String>,
    index: usize,
}

impl ScanFrame {
    fn child_pointer(&self) -> String {
        match &self.keys {
            None => pointer_below(&self.pointer, &self.index.to_string()),
            Some(_) => pointer_below(&self.pointer, self.key.as_deref().unwrap_or("")),
        }
    }
}

/// The JSON Pointer of the first key given twice in one object of `text`, which a parser already
/// accepted; `None` when every key is given once. Iterative: a hostile document may nest deeper
/// than the call stack.
///
/// # Errors
///
/// An [`InternalError`] when a string the parser accepted has no closing quote or does not decode.
pub fn duplicate_key_pointer(text: &str) -> Result<Option<String>, InternalError> {
    let bytes = text.as_bytes();
    let mut stack: Vec<ScanFrame> = Vec::new();
    let mut expecting_key = false;
    let mut at = 0;

    while let Some(byte) = bytes.get(at).copied() {
        match byte {
            b'"' => {
                let end = string_end(bytes, at)?;
                let decoded = decoded_string(text, at, end)?;

                at = end;

                if let Some(duplicate) = register_key(&mut stack, &mut expecting_key, decoded) {
                    return Ok(Some(duplicate));
                }
            }
            b'{' | b'[' => {
                let pointer = stack
                    .last()
                    .map_or_else(String::new, ScanFrame::child_pointer);
                let is_object = byte == b'{';

                stack.push(ScanFrame {
                    pointer,
                    keys: is_object.then(HashSet::new),
                    key: None,
                    index: 0,
                });
                expecting_key = is_object;
            }
            b'}' | b']' => {
                stack.pop();
            }
            b',' => {
                if let Some(top) = stack.last_mut() {
                    top.index += 1;
                }

                expecting_key = stack.last().is_some_and(|top| top.keys.is_some());
            }
            _ => {}
        }

        at += 1;
    }

    Ok(None)
}

/// Records `decoded` as the key just read when one is expected; the pointer of a repeated key.
fn register_key(
    stack: &mut [ScanFrame],
    expecting_key: &mut bool,
    decoded: String,
) -> Option<String> {
    let top = stack.last_mut()?;

    if !*expecting_key {
        return None;
    }

    let keys = top.keys.as_mut()?;

    if keys.contains(&decoded) {
        return Some(pointer_below(&top.pointer, &decoded));
    }

    keys.insert(decoded.clone());
    top.key = Some(decoded);
    *expecting_key = false;

    None
}

fn decoded_string(text: &str, start: usize, end: usize) -> Result<String, InternalError> {
    text.get(start..=end)
        .and_then(|literal| serde_json::from_str::<String>(literal).ok())
        .ok_or_else(|| {
            InternalError::new("bundle: a JSON string accepted by JSON.parse does not decode.")
        })
}

/// The index of the closing quote of the string that opens at `start`.
fn string_end(bytes: &[u8], start: usize) -> Result<usize, InternalError> {
    let mut at = start + 1;

    while let Some(byte) = bytes.get(at).copied() {
        match byte {
            b'\\' => at += 1,
            b'"' => return Ok(at),
            _ => {}
        }

        at += 1;
    }

    Err(InternalError::new(
        "bundle: a JSON string accepted by JSON.parse has no closing quote.",
    ))
}

/// The text of `bytes` when they are UTF-8; a byte order mark is kept, so the caller refuses it.
#[must_use]
pub fn utf8_text(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_given_twice_in_one_object_is_found_by_its_pointer() {
        let cases = [
            (r#"{"a": 1, "b": {"c": [1, {"d": 1}]}}"#, None),
            (r#"{"a": {"x": 1}, "b": {"x": 1}}"#, None),
            (r#"{"a": 1, "a": 2}"#, Some("/a")),
            (
                r#"{"a": [0, {"k\"/": 1, "k\u0022/": 2}]}"#,
                Some("/a/1/k\"~1"),
            ),
            (r#"["{\"a\": 1, \"a\": 2}"]"#, None),
        ];

        for (text, expected) in cases {
            assert_eq!(
                duplicate_key_pointer(text)
                    .unwrap_or_else(|error| panic!("text {text}: {error}"))
                    .as_deref(),
                expected,
                "text {text}"
            );
        }
    }

    #[test]
    fn a_byte_order_mark_is_refused_not_dropped() {
        let text = utf8_text(&[0xef, 0xbb, 0xbf, 0x7b, 0x7d]).unwrap();

        assert_eq!(
            parse_untrusted_json(&text),
            UntrustedJson::Refused {
                problem: "starts with a byte order mark (U+FEFF)".to_owned()
            }
        );
    }

    #[test]
    fn a_reserved_key_is_refused_with_its_pointer() {
        assert_eq!(
            parse_untrusted_json(r#"{"a": [{"__proto__": 1}]}"#),
            UntrustedJson::Refused {
                problem: "holds the reserved key at '/a/0/__proto__'".to_owned()
            }
        );
    }
}
