//! The canonical order of the IR's arrays (ADR 0004 section 9): each array of the "Sorted" column
//! is sorted by its key, then by the element's canonical bytes on a tie; every other array keeps
//! the order its pass wrote.
//!
//! Names, codes and keys compare by UTF-16 code units and statuses as numbers, so the order
//! depends on no locale. Records need no order here: the writer sorts their members.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::LazyLock;

use seampact_diagnostics::InternalError;
use seampact_ir::{IrInstanceNode, walk_ir_instance};
use seampact_js::cmp_utf16;
use seampact_json::{
    JsonObject, JsonValue, MAX_SAFE_INTEGER, canonical_document, escape_pointer, json_at,
    pointer_segments,
};

use crate::record::finalize_is_record;

/// One comparison of a sort key: an item's text or number at a path below it.
#[derive(Debug, Clone, Copy)]
enum KeyPart {
    /// The text at the path; an absent text sorts first, as an empty one.
    Text(&'static [&'static str]),
    /// The number at the path; an absent number sorts first, as zero, and `false` before `true`.
    Number(&'static [&'static str]),
    /// The status of the error code of an operation's error: no declaration sorts last.
    ErrorStatus,
}

const VALUE: &[KeyPart] = &[KeyPart::Text(&[])];
const HEADER_USE: &[KeyPart] = &[KeyPart::Text(&["header"]), KeyPart::Text(&["for"])];

/// The key of each "Sorted" row of ADR 0004 section 9, by `Definition.member`.
const SORTED_ARRAYS: &[(&str, &[KeyPart])] = &[
    ("ApiDocument.surfaces", VALUE),
    ("Cache.perCallerKind", &[KeyPart::Text(&["caller"])]),
    ("Cache.vary", VALUE),
    ("ContractIR.features", VALUE),
    ("ContractIR.kinds", VALUE),
    ("ContractIR.operations", &[KeyPart::Text(&["id"])]),
    ("CredentialIdentity.errors", VALUE),
    ("CredentialIdentity.headers", HEADER_USE),
    ("CredentialSchemes.optionalRead", VALUE),
    ("CredentialSchemes.read", VALUE),
    ("CredentialSchemes.write", VALUE),
    ("Degradable.paths", VALUE),
    ("Enum.directions", VALUE),
    ("ExtensionKeyDecl.places", VALUE),
    ("IdentityAccess.schemes", VALUE),
    (
        "Lint.allows",
        &[
            KeyPart::Text(&["rule"]),
            KeyPart::Text(&["at", "api"]),
            KeyPart::Text(&["at", "layer"]),
            KeyPart::Text(&["at", "pointer"]),
            KeyPart::Number(&["subtree"]),
        ],
    ),
    ("MapSchema.directions", VALUE),
    ("ObjectSchema.directions", VALUE),
    (
        "Operation.bindings",
        &[
            KeyPart::Text(&["from", "in"]),
            KeyPart::Text(&["from", "name"]),
            KeyPart::Number(&["from", "prefixBits"]),
            KeyPart::Text(&["to", "in"]),
            KeyPart::Text(&["to", "name"]),
            KeyPart::Number(&["to", "prefixBits"]),
        ],
    ),
    ("Operation.callerKinds", VALUE),
    (
        "Operation.errors",
        &[KeyPart::ErrorStatus, KeyPart::Text(&["code"])],
    ),
    ("Operation.features", VALUE),
    (
        "Operation.fieldRights",
        &[
            KeyPart::Text(&["schema"]),
            KeyPart::Text(&["pointer"]),
            KeyPart::Text(&["direction"]),
        ],
    ),
    ("Operation.principalRequires", &[KeyPart::Text(&["field"])]),
    ("Operation.responses", &[KeyPart::Number(&["status"])]),
    ("Operation.tags", VALUE),
    ("OperationError.roles", &[KeyPart::Text(&["role"])]),
    ("OptionalAccess.schemes", VALUE),
    ("Paging.sortKeys", &[KeyPart::Text(&["key"])]),
    ("PagingStyle.handlerResult", VALUE),
    ("Right.errors", VALUE),
    ("Rule.errors", VALUE),
    ("Scalar.directions", VALUE),
    ("Scope.errors", VALUE),
    ("SignedIdentity.errors", VALUE),
    ("SignedIdentity.headers", HEADER_USE),
    ("UnionSchema.directions", VALUE),
    ("UnionSchema.variants", &[KeyPart::Text(&["tag"])]),
];

static SORTED_ARRAY_KEYS: LazyLock<HashMap<&'static str, &'static [KeyPart]>> =
    LazyLock::new(|| SORTED_ARRAYS.iter().copied().collect());

const CONTRACT_IR_REFERENCE: &str = "#/$defs/ContractIR";

/// The `Definition.member` rows finalize sorts, for the test against ADR 0004 section 9.
#[must_use]
pub fn finalize_sorted_array_rows() -> Vec<&'static str> {
    SORTED_ARRAYS.iter().map(|(row, _)| *row).collect()
}

// The value at `path` below an array element; absent when a step is no record or lacks the member.
fn member_at<'item>(item: &'item JsonValue, path: &[&str]) -> Option<&'item JsonValue> {
    let mut current = item;

    for member in path {
        current = finalize_is_record(current)?.get(member)?;
    }

    Some(current)
}

fn text_of(item: &JsonValue, path: &[&str]) -> String {
    match member_at(item, path) {
        Some(JsonValue::String(text)) => text.clone(),
        _ => String::new(),
    }
}

fn number_of(item: &JsonValue, path: &[&str]) -> f64 {
    match member_at(item, path) {
        Some(JsonValue::Number(number)) => number.to_f64(),
        Some(JsonValue::Bool(true)) => 1.0,
        _ => 0.0,
    }
}

// The sign of `a - b`, as the TypeScript comparator answers it.
fn compare_number(left: f64, right: f64) -> Ordering {
    let difference = left - right;

    if difference < 0.0 {
        Ordering::Less
    } else if difference > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

/// The status of each declared error code, read before any array moves.
type ErrorStatuses = HashMap<String, f64>;

#[expect(
    clippy::cast_precision_loss,
    reason = "MAX_SAFE_INTEGER is exactly representable"
)]
const STATUS_LAST: f64 = MAX_SAFE_INTEGER as f64;

fn error_statuses(errors: Option<&JsonValue>) -> ErrorStatuses {
    let Some(JsonValue::Object(errors)) = errors else {
        return ErrorStatuses::new();
    };

    errors
        .iter()
        .filter_map(|(code, declaration)| {
            let status = json_at(declaration, &["http", "status"])?;

            match status {
                JsonValue::Number(number) => Some((code.clone(), number.to_f64())),
                _ => None,
            }
        })
        .collect()
}

fn status_of(item: &JsonValue, statuses: &ErrorStatuses) -> f64 {
    match member_at(item, &["code"]) {
        Some(JsonValue::String(code)) => statuses.get(code).copied().unwrap_or(STATUS_LAST),
        _ => STATUS_LAST,
    }
}

fn compare_part(
    part: KeyPart,
    left: &JsonValue,
    right: &JsonValue,
    statuses: &ErrorStatuses,
) -> Ordering {
    match part {
        KeyPart::Text(path) => cmp_utf16(&text_of(left, path), &text_of(right, path)),
        KeyPart::Number(path) => compare_number(number_of(left, path), number_of(right, path)),
        KeyPart::ErrorStatus => {
            compare_number(status_of(left, statuses), status_of(right, statuses))
        }
    }
}

// By each key in turn, then by the element's canonical bytes on a tie.
fn compare_elements(
    key: &[KeyPart],
    left: &JsonValue,
    right: &JsonValue,
    statuses: &ErrorStatuses,
) -> Ordering {
    for part in key {
        let order = compare_part(*part, left, right, statuses);

        if order != Ordering::Equal {
            return order;
        }
    }

    cmp_utf16(&canonical_document(left), &canonical_document(right))
}

/// The order one array takes: `order[new position]` is the old position.
struct SortPlan {
    pointer: String,
    order: Vec<usize>,
}

fn plan_for(
    pointer: &str,
    items: &[JsonValue],
    key: &[KeyPart],
    statuses: &ErrorStatuses,
) -> SortPlan {
    let mut order: Vec<usize> = (0..items.len()).collect();

    order.sort_by(|left, right| match (items.get(*left), items.get(*right)) {
        (Some(left_item), Some(right_item)) => {
            compare_elements(key, left_item, right_item, statuses)
        }
        _ => Ordering::Equal,
    });

    SortPlan {
        pointer: pointer.to_owned(),
        order,
    }
}

fn plans_of(ir: &JsonValue, statuses: &ErrorStatuses) -> Result<Vec<SortPlan>, InternalError> {
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(CONTRACT_IR_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut plans = Vec::new();

    walk_ir_instance(ir, &schema, "", &mut |node| {
        let IrInstanceNode::Object {
            pointer,
            definition: Some(definition),
            value,
        } = node
        else {
            return Ok(());
        };

        for (member, items) in *value {
            let JsonValue::Array(items) = items else {
                continue;
            };
            let Some(key) = SORTED_ARRAY_KEYS.get(format!("{definition}.{member}").as_str()) else {
                continue;
            };
            let at = format!("{pointer}/{}", escape_pointer(member));

            plans.push(plan_for(&at, items, key, statuses));
        }

        Ok(())
    })
    .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(plans)
}

fn value_at_mut<'tree>(
    root: &'tree mut JsonValue,
    segments: &[String],
) -> Option<&'tree mut JsonValue> {
    let mut current = root;

    for segment in segments {
        current = match current {
            JsonValue::Object(members) => members.get_mut(segment)?,
            JsonValue::Array(items) => items.get_mut(segment.parse::<usize>().ok()?)?,
            JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {
                return None;
            }
        };
    }

    Some(current)
}

fn apply(ir: &mut JsonValue, plan: &SortPlan) -> Result<(), InternalError> {
    let broken = || {
        InternalError::new(format!(
            "finalize lost the array at '{}' while sorting",
            plan.pointer
        ))
    };
    let segments = pointer_segments(&plan.pointer).ok_or_else(broken)?;
    let Some(JsonValue::Array(items)) = value_at_mut(ir, &segments) else {
        return Err(broken());
    };
    let mut slots: Vec<Option<JsonValue>> = std::mem::take(items).into_iter().map(Some).collect();
    let mut sorted = Vec::with_capacity(slots.len());

    for old in &plan.order {
        sorted.push(
            slots
                .get_mut(*old)
                .and_then(Option::take)
                .ok_or_else(broken)?,
        );
    }

    *items = sorted;

    Ok(())
}

/// Sorts the "Sorted" arrays of `ir`, finalize's copy of the draft, in place (ADR 0004 section 9).
///
/// The TypeScript sorts each array before it walks the elements, so an element is compared in the
/// state its pass wrote; here every order is planned on the unsorted IR and applied from the
/// deepest array up, which compares the same states.
///
/// # Errors
///
/// An [`InternalError`] when the IR schemas are broken or an array planned is gone.
pub fn finalize_canonical_order(ir: &mut JsonValue) -> Result<(), InternalError> {
    let statuses = error_statuses(finalize_is_record_value(ir, "errors"));
    let plans = plans_of(ir, &statuses)?;

    for plan in plans.iter().rev() {
        apply(ir, plan)?;
    }

    Ok(())
}

fn finalize_is_record_value<'ir>(ir: &'ir JsonValue, member: &str) -> Option<&'ir JsonValue> {
    finalize_is_record(ir)?.get(member)
}
