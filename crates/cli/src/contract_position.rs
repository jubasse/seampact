//! The contract `file:line` of an IR member or an origin, read through the compiler's side table.

use indexmap::IndexMap;
use seampact_js::js_number_of_text;
use seampact_json::{JsonValue, js_text_of};
use seampact_span::Location;

use crate::explain_flow::{is_text, items_of, object_of};

/// The `layer` value of an origin that no contract file declares.
const CORE_LAYER: &str = "core";

/// The IR an api's targets read, with the file and line of each declaration; a bundle source has
/// no table, so its refusals keep the IR pointer only.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ContractPositions<'ir> {
    pub(crate) ir: &'ir JsonValue,
    pub(crate) locations: Option<&'ir IndexMap<String, Location>>,
}

/// The contract `file:line` of an IR member: the deepest node on its pointer whose origin the side
/// table locates, else the operation's own declaration.
pub(crate) fn contract_position(
    positions: &ContractPositions<'_>,
    member: Option<&str>,
    operation_id: Option<&str>,
) -> Option<String> {
    let ContractPositions { ir, locations } = positions;
    let locations = (*locations)?;
    let nodes = member.map_or_else(Vec::new, |pointer| nodes_along(ir, pointer));

    if let Some(position) = nodes
        .into_iter()
        .rev()
        .find_map(|node| located_origin(node, locations))
    {
        return Some(position);
    }

    let wanted = operation_id?;
    let operation = items_of(object_of(Some(ir)).and_then(|each| each.get("operations")))
        .iter()
        .find(|each| {
            is_text(
                object_of(Some(each)).and_then(|object| object.get("id")),
                wanted,
            )
        })?;

    located_origin(operation, locations)
}

/// The nodes of `ir` along a JSON pointer, the root first, stopping at the first missing one.
fn nodes_along<'ir>(ir: &'ir JsonValue, pointer: &str) -> Vec<&'ir JsonValue> {
    let mut nodes = vec![ir];
    let mut node = ir;

    for token in pointer.split('/').skip(1) {
        let token = token.replace("~1", "/").replace("~0", "~");
        let Some(child) = child_of(node, &token) else {
            break;
        };

        nodes.push(child);
        node = child;
    }

    nodes
}

/// The member `token` of an object, or the item `Number(token)` of an array.
fn child_of<'node>(node: &'node JsonValue, token: &str) -> Option<&'node JsonValue> {
    match node {
        JsonValue::Array(items) => {
            let index = js_number_of_text(token);

            if index.fract() != 0.0 || index < 0.0 {
                return None;
            }

            // The index is a whole, non-negative number, so the cast only saturates beyond the array.
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "checked whole and non-negative above"
            )]
            items.get(index as usize)
        }
        JsonValue::Object(object) => object.get(token),
        _ => None,
    }
}

/// The `file:line` of the origin of `node`, when it is a mapping with a located one.
fn located_origin(node: &JsonValue, locations: &IndexMap<String, Location>) -> Option<String> {
    let JsonValue::Object(object) = node else {
        return None;
    };

    origin_position(object.get("origin")?, locations)
}

/// The `file:line` of `origin` through the side table; a core declaration has no file, and an
/// element of another api is located in that api's table.
pub(crate) fn origin_position(
    origin: &JsonValue,
    locations: &IndexMap<String, Location>,
) -> Option<String> {
    let JsonValue::Object(origin) = origin else {
        return None;
    };
    let layer = js_text_of(origin.get("layer"));

    if layer == CORE_LAYER || origin.get("api").is_some() {
        return None;
    }

    let key = format!("{layer}#{}", js_text_of(origin.get("pointer")));

    locations
        .get(&key)
        .map(|location| format!("{}:{}", location.file, location.line))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(text: &str) -> JsonValue {
        serde_json::from_str(text).unwrap()
    }

    fn located(pointer: &str, line: u32) -> (String, Location) {
        let location = Location {
            file: "contract/api.yaml".to_owned(),
            line,
            column: 1,
            end_line: line,
            end_column: 2,
        };

        (format!("app#{pointer}"), location)
    }

    #[test]
    fn an_array_token_reads_as_a_javascript_number() {
        let list = json(r#"["a","b"]"#);

        for (token, expected) in [
            ("0", Some("a")),
            ("1", Some("b")),
            ("", Some("a")),
            ("01", Some("b")),
            (" 1 ", Some("b")),
            ("1e0", Some("b")),
            ("0x1", Some("b")),
            ("-0", Some("a")),
            ("1.5", None),
            ("-1", None),
            ("2", None),
            ("x", None),
        ] {
            let child = child_of(&list, token);
            let expected = expected.map(JsonValue::text);

            assert_eq!(child, expected.as_ref(), "token {token:?}");
        }
    }

    #[test]
    fn the_deepest_located_node_wins_and_the_operation_is_the_fallback() {
        let ir = json(
            r#"{"operations":[{"id":"getOrder","origin":{"layer":"app","pointer":"/ops/0"},"params":[{"origin":{"layer":"app","pointer":"/ops/0/p"}}]}]}"#,
        );
        let locations: IndexMap<String, Location> = [located("/ops/0", 3), located("/ops/0/p", 5)]
            .into_iter()
            .collect();
        let positions = ContractPositions {
            ir: &ir,
            locations: Some(&locations),
        };

        assert_eq!(
            contract_position(&positions, Some("/operations/0/params/0"), Some("getOrder"))
                .as_deref(),
            Some("contract/api.yaml:5")
        );
        assert_eq!(
            contract_position(&positions, Some("/operations/0/missing"), Some("getOrder"))
                .as_deref(),
            Some("contract/api.yaml:3")
        );
        assert_eq!(contract_position(&positions, None, Some("other")), None);
        assert_eq!(
            contract_position(
                &ContractPositions {
                    ir: &ir,
                    locations: None
                },
                None,
                Some("getOrder")
            ),
            None
        );
    }

    #[test]
    fn a_pointer_token_unescapes_slash_before_tilde() {
        let ir = json(r#"{"a/b":{"~1":{"origin":{"layer":"app","pointer":"/x"}}}}"#);
        let locations: IndexMap<String, Location> = [located("/x", 9)].into_iter().collect();
        let positions = ContractPositions {
            ir: &ir,
            locations: Some(&locations),
        };

        assert_eq!(
            contract_position(&positions, Some("/a~1b/~01"), None).as_deref(),
            Some("contract/api.yaml:9")
        );
    }
}
