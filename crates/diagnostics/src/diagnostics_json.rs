use seampact_json::JsonValue;

use crate::{Diagnostic, DiagnosticOrigin, RelatedLocation};

/// The diagnostics of one api, under the api's name.
#[derive(Debug, Clone, Copy)]
pub struct ApiDiagnostics<'run> {
    /// The api name.
    pub api: &'run str,
    /// Its diagnostics, in the order the run holds them.
    pub diagnostics: &'run [Diagnostic],
}

fn object_of(members: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        members
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

fn origin_value(origin: &DiagnosticOrigin) -> JsonValue {
    let mut members = vec![
        ("layer", JsonValue::String(origin.layer.to_string())),
        ("pointer", JsonValue::String(origin.pointer.clone())),
    ];

    if let Some(api) = &origin.api {
        members.push(("api", JsonValue::String(api.clone())));
    }

    object_of(members)
}

fn related_value(related: &RelatedLocation) -> JsonValue {
    object_of(vec![
        ("origin", origin_value(&related.origin)),
        ("message", JsonValue::String(related.message.clone())),
    ])
}

fn diagnostic_value(diagnostic: &Diagnostic) -> JsonValue {
    object_of(vec![
        (
            "severity",
            JsonValue::String(diagnostic.severity.as_str().to_owned()),
        ),
        (
            "rule",
            JsonValue::String(diagnostic.rule.as_str().to_owned()),
        ),
        ("message", JsonValue::String(diagnostic.message.clone())),
        ("fix", JsonValue::String(diagnostic.fix.clone())),
        ("origin", origin_value(&diagnostic.origin)),
        (
            "related",
            JsonValue::Array(diagnostic.related.iter().map(related_value).collect()),
        ),
    ])
}

fn list_value(diagnostics: &[Diagnostic]) -> JsonValue {
    JsonValue::Array(diagnostics.iter().map(diagnostic_value).collect())
}

/// The value of a run's `diagnostics.json`: `workspace`, then `apis`, each api with its
/// `diagnostics`.
///
/// Members are in the order the TypeScript writes them (`severity`, `rule`, `message`, `fix`,
/// `origin`, `related`; an origin's `layer`, `pointer`, then `api` when set), and the file is
/// that order written as is, never sorted: sorting the members of this value moves `api` first
/// and breaks the expected files.
#[must_use]
pub fn diagnostics_json(workspace: &[Diagnostic], apis: &[ApiDiagnostics<'_>]) -> JsonValue {
    let api_values = apis
        .iter()
        .map(|entry| {
            object_of(vec![
                ("api", JsonValue::String(entry.api.to_owned())),
                ("diagnostics", list_value(entry.diagnostics)),
            ])
        })
        .collect();

    object_of(vec![
        ("workspace", list_value(workspace)),
        ("apis", JsonValue::Array(api_values)),
    ])
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::Value;

    use super::*;
    use crate::{DiagnosticLayer, RuleId, Severity};

    fn text_of<'value>(value: &'value Value, member: &str) -> &'value str {
        value[member].as_str().expect("fixture member is text")
    }

    fn origin_of(value: &Value) -> DiagnosticOrigin {
        let layer = match text_of(value, "layer") {
            "api" => DiagnosticLayer::Api,
            "shared" => DiagnosticLayer::Shared,
            "base" => DiagnosticLayer::Base,
            "workspace" => DiagnosticLayer::Workspace,
            pack => DiagnosticLayer::Pack(pack.trim_start_matches("pack:").to_owned()),
        };

        DiagnosticOrigin {
            api: value["api"].as_str().map(str::to_owned),
            layer,
            pointer: text_of(value, "pointer").to_owned(),
        }
    }

    fn diagnostics_of(list: &Value) -> Vec<Diagnostic> {
        list.as_array()
            .expect("fixture list")
            .iter()
            .map(|entry| Diagnostic {
                severity: match text_of(entry, "severity") {
                    "error" => Severity::Error,
                    _ => Severity::Warning,
                },
                rule: RuleId::new(text_of(entry, "rule").to_owned()),
                message: text_of(entry, "message").to_owned(),
                fix: text_of(entry, "fix").to_owned(),
                origin: origin_of(&entry["origin"]),
                related: entry["related"]
                    .as_array()
                    .expect("fixture related list")
                    .iter()
                    .map(|related| RelatedLocation {
                        origin: origin_of(&related["origin"]),
                        message: text_of(related, "message").to_owned(),
                    })
                    .collect(),
            })
            .collect()
    }

    // Every object's member names, depth first: the order a writer that keeps it would print.
    fn member_orders(value: &JsonValue, orders: &mut Vec<Vec<String>>) {
        match value {
            JsonValue::Object(object) => {
                orders.push(object.keys().cloned().collect());

                for member in object.values() {
                    member_orders(member, orders);
                }
            }
            JsonValue::Array(items) => {
                for item in items {
                    member_orders(item, orders);
                }
            }
            _ => {}
        }
    }

    fn assert_rebuilds_fixture(path: &str) {
        let full = format!(
            "{}/../../fixtures/expected/{path}/diagnostics.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let text = fs::read_to_string(&full).expect("fixture is readable");
        let parsed: Value = serde_json::from_str(&text).expect("fixture is JSON");
        let expected = JsonValue::try_from(parsed.clone()).expect("fixture is a JSON value");

        let workspace = diagnostics_of(&parsed["workspace"]);
        let api_lists: Vec<(String, Vec<Diagnostic>)> = parsed["apis"]
            .as_array()
            .expect("fixture apis")
            .iter()
            .map(|entry| {
                (
                    text_of(entry, "api").to_owned(),
                    diagnostics_of(&entry["diagnostics"]),
                )
            })
            .collect();
        let apis: Vec<ApiDiagnostics<'_>> = api_lists
            .iter()
            .map(|(api, diagnostics)| ApiDiagnostics { api, diagnostics })
            .collect();

        let built = diagnostics_json(&workspace, &apis);
        let (mut built_orders, mut expected_orders) = (Vec::new(), Vec::new());

        member_orders(&built, &mut built_orders);
        member_orders(&expected, &mut expected_orders);

        assert_eq!(built, expected, "{path}");
        assert_eq!(built_orders, expected_orders, "member order of {path}");
    }

    #[test]
    fn the_value_keeps_the_member_order_of_a_cross_api_fixture() {
        assert_rebuilds_fixture("rules/workspace-relay-cycle");
    }

    #[test]
    fn the_value_keeps_the_member_order_of_a_pack_layer_fixture() {
        assert_rebuilds_fixture("loader/composition/pack-not-data");
    }
}
