//! The `# not shown yet` line: the members of an operation the explain view does not render.

use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue};

use crate::explain_flow::{items_of, object_of};

/// Members the view shows through others, or that only name the operation.
const SHOWN_THROUGH_OTHERS: [&str; 10] = [
    "kind",
    "id",
    "name",
    "op",
    "resource",
    "safe",
    "callerKinds",
    "docs",
    "extensions",
    "origin",
];

/// The members the view writes a line or block for.
pub(crate) const RENDERED: [&str; 29] = [
    "surface",
    "method",
    "path",
    "access",
    "csrf",
    "scopes",
    "requires",
    "params",
    "unknownQuery",
    "input",
    "idempotency",
    "concurrency",
    "responses",
    "errors",
    "fieldRights",
    "cache",
    "paging",
    "filteredBy",
    "owner",
    "degradable",
    "budgetMs",
    "deadlineHeader",
    "deprecated",
    "relays",
    "upstream",
    "maturity",
    "internal",
    "format",
    "tags",
];

/// The nested members of the params, the errors and the response headers the view renders or only
/// comments, by the list they sit in.
const NESTED_RENDERED: [(&str, &[&str]); 3] = [
    ("params", &["name", "type", "required", "origin", "derivedFrom"]),
    ("errors", &["code", "origin", "derivedFrom"]),
    ("responses.headers", &["name"]),
];

/// Whether the view would write nothing for `value`: an empty array or mapping, `false`.
pub(crate) fn is_empty_value(value: &JsonValue) -> bool {
    match value {
        JsonValue::Array(items) => items.is_empty(),
        JsonValue::Object(object) => object.is_empty(),
        JsonValue::Bool(flag) => !flag,
        JsonValue::Null | JsonValue::Number(_) | JsonValue::String(_) => false,
    }
}

/// The names of the members left out, sorted, on one comment line; none when nothing is left out.
pub(crate) fn not_shown_line(operation: &JsonObject) -> Option<String> {
    let mut not_shown: Vec<String> = operation
        .iter()
        .filter(|(member, value)| {
            !RENDERED.contains(&member.as_str())
                && !SHOWN_THROUGH_OTHERS.contains(&member.as_str())
                && !is_empty_value(value)
        })
        .map(|(member, _)| member.clone())
        .collect();

    not_shown.extend(nested_not_shown(operation));
    not_shown.sort_by(|left, right| cmp_utf16(left, right));

    if not_shown.is_empty() {
        return None;
    }

    Some(format!("# not shown yet: {}", not_shown.join(", ")))
}

/// `list.member` for each nested member the view leaves out, each once per list.
fn nested_not_shown(operation: &JsonObject) -> Vec<String> {
    let params = object_of(operation.get("params"));
    let param_items = ["path", "query", "header"]
        .iter()
        .flat_map(|place| items_of(params.and_then(|params| params.get(place))));
    let header_items = items_of(operation.get("responses"))
        .iter()
        .flat_map(|response| items_of(object_of(Some(response)).and_then(|each| each.get("headers"))));
    let lists: [(&str, Vec<&JsonValue>); 3] = [
        ("params", param_items.collect()),
        ("errors", items_of(operation.get("errors")).iter().collect()),
        ("responses.headers", header_items.collect()),
    ];
    let mut left_out: Vec<String> = Vec::new();

    for (list, items) in lists {
        let rendered: &[&str] = NESTED_RENDERED
            .iter()
            .find(|(name, _)| *name == list)
            .map_or(&[], |(_, members)| members);
        let mut listed: Vec<String> = Vec::new();

        for item in items {
            let Some(item) = object_of(Some(item)) else {
                continue;
            };

            for (member, value) in item {
                let name = format!("{list}.{member}");

                if !rendered.contains(&member.as_str())
                    && !is_empty_value(value)
                    && !listed.contains(&name)
                {
                    listed.push(name);
                }
            }
        }

        left_out.extend(listed);
    }

    left_out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_values_are_empty_containers_and_false_only() {
        let values = [
            ("[]", true),
            ("{}", true),
            ("false", true),
            ("0", false),
            ("\"\"", false),
            ("null", false),
            ("[0]", false),
        ];

        for (text, empty) in values {
            let value: JsonValue = serde_json::from_str(text).unwrap();

            assert_eq!(is_empty_value(&value), empty, "value {text}");
        }
    }

    #[test]
    fn left_out_members_sort_by_utf16_code_unit() {
        let operation: JsonValue = serde_json::from_str(
            r#"{"zeta":1,"Beta":1,"😀":1,"～":1,"surface":"x","docs":{"a":1},"id":"x"}"#,
        )
        .unwrap();
        let JsonValue::Object(operation) = operation else {
            panic!("an object");
        };

        assert_eq!(
            not_shown_line(&operation).as_deref(),
            Some("# not shown yet: Beta, zeta, \u{1f600}, \u{ff5e}")
        );
    }
}
