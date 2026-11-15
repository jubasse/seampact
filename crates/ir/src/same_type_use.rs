//! Whether two type uses accept the same values (ADR 0004 section 5).

use seampact_json::{JsonObject, JsonValue, canonical_json};

use crate::{IrError, TypeUse};

/// The members that say where and how a use is written, not what it accepts.
const ANNOTATION_MEMBERS: [&str; 4] = ["docs", "examples", "origin", "reason"];

/// True when the two type uses differ in annotations only: `docs`, `examples`, `origin` and a
/// narrowing's `reason` are left out at every depth before the canonical comparison.
///
/// # Errors
///
/// [`IrError::Encode`] or [`IrError::Value`] when a type use does not encode.
pub fn is_ir_same_type_use(left: &TypeUse, right: &TypeUse) -> Result<bool, IrError> {
    Ok(canonical_without_annotations(left)? == canonical_without_annotations(right)?)
}

// The canonical JSON text of a type use, the annotation members left out.
fn canonical_without_annotations(type_use: &TypeUse) -> Result<String, IrError> {
    let encoded = serde_json::to_value(type_use).map_err(IrError::Encode)?;
    let value = without_annotations(JsonValue::try_from(encoded)?);

    Ok(canonical_json(&value))
}

fn without_annotations(value: JsonValue) -> JsonValue {
    match value {
        JsonValue::Array(items) => {
            JsonValue::Array(items.into_iter().map(without_annotations).collect())
        }
        JsonValue::Object(members) => {
            let kept: JsonObject = members
                .into_iter()
                .filter(|(key, _)| !ANNOTATION_MEMBERS.contains(&key.as_str()))
                .map(|(key, member)| (key, without_annotations(member)))
                .collect();

            JsonValue::Object(kept)
        }
        scalar @ (JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::String(_)) => scalar,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn type_use(value: serde_json::Value) -> TypeUse {
        serde_json::from_value(value).unwrap()
    }

    fn same(left: serde_json::Value, right: serde_json::Value) -> bool {
        is_ir_same_type_use(&type_use(left), &type_use(right)).unwrap()
    }

    #[test]
    fn annotations_at_any_depth_do_not_tell_two_uses_apart() {
        let plain = json!({"kind": "array", "items": {"kind": "ref", "schema": "Task"}});
        let annotated = json!({
            "kind": "array",
            "docs": {"summary": "The tasks."},
            "items": {"kind": "ref", "schema": "Task", "docs": {"description": "One task."}}
        });

        assert!(same(plain, annotated));
    }

    #[test]
    fn what_a_use_accepts_tells_two_uses_apart() {
        let task = json!({"kind": "ref", "schema": "Task"});
        let label = json!({"kind": "ref", "schema": "Label"});
        let tasks = json!({"kind": "array", "items": {"kind": "ref", "schema": "Task"}});

        assert!(same(task.clone(), task.clone()));
        assert!(!same(task.clone(), label));
        assert!(!same(task, tasks));
    }

    #[test]
    fn a_count_tells_two_uses_apart() {
        let tasks = |min_items: u32| json!({"kind": "array", "minItems": min_items, "items": {"kind": "ref", "schema": "Task"}});

        assert!(same(tasks(2), tasks(2)));
        assert!(!same(tasks(2), tasks(3)));
    }
}
