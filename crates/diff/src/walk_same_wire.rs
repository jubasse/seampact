//! Whether two schemas, enums or type uses of two IRs are one thing on the wire.

use std::cmp::Ordering;
use std::collections::HashSet;

use seampact_ir::ContractIr;
use seampact_json::JsonValue;

use crate::DiffError;
use crate::walk_json::{is_record, json_of, member_names};

/// The members that name, document or derive a thing without changing what the wire carries.
const WIRE_NEUTRAL_MEMBERS: [&str; 14] = [
    "codeName",
    "codeNames",
    "deprecated",
    "derivedFrom",
    "directions",
    "docs",
    "examples",
    "extensions",
    "id",
    "origin",
    "reason",
    "scalar",
    "sensitive",
    "typeName",
];

/// Joins the two ids of a schema pair the TypeScript assumed equal.
const PAIR_SEPARATOR: &str = "\u{0}";

/// The two IRs of one comparison and the schema pairs assumed equal while they are compared, which
/// ends a recursive schema.
struct WireComparison<'run> {
    before: &'run ContractIr,
    after: &'run ContractIr,
    assumed: HashSet<String>,
}

/// Whether the schema `before_id` of `before` and `after_id` of `after` have one wire shape.
pub(crate) fn is_same_wire_schema(
    before: &ContractIr,
    before_id: &str,
    after: &ContractIr,
    after_id: &str,
) -> Result<bool, DiffError> {
    same_schema_ids(
        &mut WireComparison {
            before,
            after,
            assumed: HashSet::new(),
        },
        before_id,
        after_id,
    )
}

/// Whether the enum `before_id` of `before` and `after_id` of `after` have one wire shape.
pub(crate) fn is_same_wire_enum(
    before: &ContractIr,
    before_id: &str,
    after: &ContractIr,
    after_id: &str,
) -> Result<bool, DiffError> {
    same_enum_ids(
        &mut WireComparison {
            before,
            after,
            assumed: HashSet::new(),
        },
        before_id,
        after_id,
    )
}

fn same_schema_ids(
    comparison: &mut WireComparison<'_>,
    before_id: &str,
    after_id: &str,
) -> Result<bool, DiffError> {
    let pair = format!("{before_id}{PAIR_SEPARATOR}{after_id}");

    if !comparison.assumed.insert(pair) {
        return Ok(true);
    }

    let (Some(before_schema), Some(after_schema)) = (
        comparison.before.schemas.get(before_id),
        comparison.after.schemas.get(after_id),
    ) else {
        return Ok(false);
    };

    same_wire(
        comparison,
        Some(&json_of(before_schema)?),
        Some(&json_of(after_schema)?),
    )
}

fn same_enum_ids(
    comparison: &mut WireComparison<'_>,
    before_id: &str,
    after_id: &str,
) -> Result<bool, DiffError> {
    let (Some(before_enum), Some(after_enum)) = (
        comparison.before.enums.get(before_id),
        comparison.after.enums.get(after_id),
    ) else {
        return Ok(false);
    };

    same_wire(
        comparison,
        Some(&json_of(before_enum)?),
        Some(&json_of(after_enum)?),
    )
}

/// Whether two JSON values have one wire shape: arrays item by item, objects member by member
/// outside the neutral ones, any other value by `===`.
fn same_wire(
    comparison: &mut WireComparison<'_>,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) -> Result<bool, DiffError> {
    if matches!(before, Some(JsonValue::Array(_))) || matches!(after, Some(JsonValue::Array(_))) {
        return same_arrays(comparison, before, after);
    }

    let (Some(JsonValue::Object(before_members)), Some(JsonValue::Object(after_members))) =
        (before, after)
    else {
        return Ok(strictly_equal(before, after));
    };

    for member in member_names(Some(before_members), Some(after_members)) {
        if WIRE_NEUTRAL_MEMBERS.contains(&member) {
            continue;
        }

        let before_value = before_members.get(member);
        let after_value = after_members.get(member);

        // A canonical name object; a string `name` is a wire name (a property's, a param's).
        if member == "name" && (is_record(before_value) || is_record(after_value)) {
            continue;
        }

        let same = match (member, before_value, after_value) {
            ("schema", Some(JsonValue::String(before_id)), Some(JsonValue::String(after_id))) => {
                same_schema_ids(comparison, before_id, after_id)?
            }
            ("enum", Some(JsonValue::String(before_id)), Some(JsonValue::String(after_id))) => {
                same_enum_ids(comparison, before_id, after_id)?
            }
            _ => same_wire(comparison, before_value, after_value)?,
        };

        if !same {
            return Ok(false);
        }
    }

    Ok(true)
}

fn same_arrays(
    comparison: &mut WireComparison<'_>,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) -> Result<bool, DiffError> {
    let (Some(JsonValue::Array(before_items)), Some(JsonValue::Array(after_items))) =
        (before, after)
    else {
        return Ok(false);
    };

    if before_items.len() != after_items.len() {
        return Ok(false);
    }

    for (before_item, after_item) in before_items.iter().zip(after_items) {
        if !same_wire(comparison, Some(before_item), Some(after_item))? {
            return Ok(false);
        }
    }

    Ok(true)
}

/// JavaScript `===` on two values that are not both objects: numbers by value, so `-0` equals `0`.
fn strictly_equal(before: Option<&JsonValue>, after: Option<&JsonValue>) -> bool {
    match (before, after) {
        (None, None) | (Some(JsonValue::Null), Some(JsonValue::Null)) => true,
        (Some(JsonValue::Bool(left)), Some(JsonValue::Bool(right))) => left == right,
        (Some(JsonValue::Number(left)), Some(JsonValue::Number(right))) => {
            left.to_f64().partial_cmp(&right.to_f64()) == Some(Ordering::Equal)
        }
        (Some(JsonValue::String(left)), Some(JsonValue::String(right))) => left == right,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::sample_ir::sample_ir;
    use crate::test_walk::ir_value;

    fn same(before: serde_json::Value, after: serde_json::Value) -> bool {
        let ir = sample_ir();
        let mut comparison = WireComparison {
            before: &ir,
            after: &ir,
            assumed: HashSet::new(),
        };

        same_wire(
            &mut comparison,
            Some(&ir_value(before)),
            Some(&ir_value(after)),
        )
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn names_ids_and_annotations_leave_the_wire_alone_and_any_other_member_changes_it() {
        assert!(same(
            json!({"id": "A", "docs": {"summary": "a"}, "typeName": "x", "values": ["a"]}),
            json!({"id": "B", "docs": {}, "typeName": "y", "values": ["a"]}),
        ));
        assert!(!same(json!({"values": ["a"]}), json!({"values": ["b"]})));
        assert!(
            !same(json!({"values": ["a"]}), json!({})),
            "a member on one side only"
        );
    }

    #[test]
    fn a_canonical_name_object_is_neutral_and_a_string_name_is_a_wire_name() {
        assert!(same(
            json!({"name": {"role": "schema", "segments": ["a"]}}),
            json!({"name": {"role": "schema", "segments": ["b"]}}),
        ));
        assert!(same(
            json!({"name": {"role": "schema", "segments": ["a"]}}),
            json!({"name": "wire"}),
        ));
        assert!(same(json!({"name": "a"}), json!({"name": "a"})));
        assert!(!same(json!({"name": "a"}), json!({"name": "b"})));
    }

    #[test]
    fn arrays_compare_by_length_then_item_by_item_and_numbers_by_value() {
        assert!(same(json!({"list": [1, 2]}), json!({"list": [1, 2]})));
        assert!(!same(json!({"list": [1, 2]}), json!({"list": [2, 1]})));
        assert!(!same(json!({"list": [1]}), json!({"list": [1, 2]})));
        assert!(!same(json!({"list": [1]}), json!({"list": 1})));
        assert!(same(json!({"zero": -0.0}), json!({"zero": 0})));
        assert!(!same(json!({"flag": null}), json!({"flag": false})));
    }

    #[test]
    fn a_reference_to_a_missing_schema_or_enum_is_never_the_same_wire() {
        let ir = sample_ir();

        assert_eq!(is_same_wire_schema(&ir, "Absent", &ir, "Absent"), Ok(false));
        assert_eq!(is_same_wire_enum(&ir, "Absent", &ir, "Absent"), Ok(false));
        assert_eq!(is_same_wire_schema(&ir, "Event", &ir, "Event"), Ok(true));
    }

    #[test]
    fn a_pair_met_again_while_compared_is_assumed_equal_which_ends_a_recursive_schema() {
        let ir = sample_ir();
        let mut comparison = WireComparison {
            before: &ir,
            after: &ir,
            assumed: HashSet::from(["Event\u{0}Event".to_owned()]),
        };

        assert_eq!(same_schema_ids(&mut comparison, "Event", "Event"), Ok(true));
    }
}
