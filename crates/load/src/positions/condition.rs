//! Whether the `if` of a schema holds for the mapping or the list being read.

use seampact_json::JsonValue;

use super::schema_node::{SchemaNode, SchemaValue};

/// What a scalar key of a mapping being read holds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScalarRead<'value> {
    /// The key holds a mapping or a list (`NOT_SCALAR`).
    NotScalar,
    /// The resolved value of the scalar.
    Scalar(&'value JsonValue),
}

/// What a mapping being read says about itself, to choose among conditional branches.
pub trait MapView {
    /// Whether the mapping has the key.
    fn has(&self, key: &str) -> bool;

    /// The resolved value of a key the mapping has.
    fn scalar(&self, key: &str) -> ScalarRead<'_>;

    /// True when the mapping may hold more keys than it shows (`$include`, or it is itself an
    /// included file's part): a key not seen is then not known to be absent.
    fn open(&self) -> bool;
}

/// The value holding the child a condition is asked about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Container {
    Object,
    Array,
}

impl Container {
    fn type_name(self) -> &'static str {
        match self {
            Self::Object => "object",
            Self::Array => "array",
        }
    }
}

/// Conditions that all hold: false when one is false, true when all are, else unknown.
fn and(parts: &[Option<bool>]) -> Option<bool> {
    if parts.contains(&Some(false)) {
        return Some(false);
    }

    parts.iter().all(|part| *part == Some(true)).then_some(true)
}

/// Whether a condition (an `if`) holds for the value holding the child: `Some` when it can be
/// told, `None` when it cannot. `container` is that value's type; `view`, when given, shows its
/// keys. Only the forms the grammar writes are understood.
pub(super) fn holds(
    condition: &SchemaValue,
    container: Container,
    view: Option<&dyn MapView>,
) -> Option<bool> {
    let node = match condition {
        SchemaValue::Bool(decided) => return Some(*decided),
        SchemaValue::Object(node) => node,
        _ => return None,
    };
    let mut parts = Vec::new();

    for (keyword, value) in node.members() {
        match keyword.as_str() {
            "$comment" | "description" | "title" => {}
            "type" => parts.push(Some(names_include(value, container))),
            "required" => parts.push(required_hold(value, view)),
            "properties" => properties_hold(value, view, &mut parts),
            "anyOf" | "allOf" => parts.push(combination_holds(keyword, value, container, view)),
            "not" => parts.push(holds(value, container, view).map(|inner| !inner)),
            _ => parts.push(None),
        }
    }

    and(&parts)
}

/// Whether `container` is among the type names a `type` keyword gives, as a name or a list.
fn names_include(value: &SchemaValue, container: Container) -> bool {
    let is_container = |name: &SchemaValue| matches!(name, SchemaValue::String(text) if text == container.type_name());

    match value {
        SchemaValue::Array(names) => names.iter().any(is_container),
        single => is_container(single),
    }
}

/// `required`: true when the view has every key, false when it lacks one it cannot get later.
///
/// A name that is no string is no key the view can have.
fn required_hold(value: &SchemaValue, view: Option<&dyn MapView>) -> Option<bool> {
    let view = view?;
    let keys = match value {
        SchemaValue::Array(keys) => keys.as_slice(),
        _ => &[],
    };
    let presence: Vec<Option<bool>> = keys
        .iter()
        .map(|key| match key {
            SchemaValue::String(name) if view.has(name) => Some(true),
            _ if view.open() => None,
            _ => Some(false),
        })
        .collect();

    and(&presence)
}

/// `properties` of a condition: each key the view has must hold the `const` the condition gives.
fn properties_hold(value: &SchemaValue, view: Option<&dyn MapView>, parts: &mut Vec<Option<bool>>) {
    let Some(view) = view else {
        parts.push(None);

        return;
    };
    let Some(properties) = value.as_node() else {
        return;
    };

    for (key, sub) in properties.members() {
        if matches!(sub, SchemaValue::Bool(true)) {
            continue;
        }

        if !view.has(key) {
            // Vacuous when absent, unless an include may still bring it.
            if view.open() {
                parts.push(None);
            }

            continue;
        }

        parts.push(property_holds(key, sub, view));
    }
}

/// A key the view has against a `{ const: ... }` condition; other forms cannot be told.
fn property_holds(key: &str, condition: &SchemaValue, view: &dyn MapView) -> Option<bool> {
    let constant = condition.as_node().and_then(only_const)?;

    match view.scalar(key) {
        ScalarRead::NotScalar => None,
        ScalarRead::Scalar(actual) => Some(strictly_equals(actual, constant)),
    }
}

/// The `const` of a node that holds nothing else.
fn only_const(node: &SchemaNode) -> Option<&SchemaValue> {
    let mut members = node.members();
    let (key, constant) = members.next()?;

    (key == "const" && members.next().is_none()).then_some(constant)
}

/// `actual === constant` for a scalar and a value written in a schema.
#[expect(
    clippy::float_cmp,
    reason = "`===` on JavaScript numbers is an exact comparison of the two f64"
)]
fn strictly_equals(actual: &JsonValue, constant: &SchemaValue) -> bool {
    match (actual, constant) {
        (JsonValue::Null, SchemaValue::Null) => true,
        (JsonValue::Bool(left), SchemaValue::Bool(right)) => left == right,
        (JsonValue::Number(left), SchemaValue::Number(right)) => left.to_f64() == right.to_f64(),
        (JsonValue::String(left), SchemaValue::String(right)) => left == right,
        _ => false,
    }
}

/// `anyOf` is true when a member is, false when all are false; `allOf` is the conjunction.
fn combination_holds(
    keyword: &str,
    value: &SchemaValue,
    container: Container,
    view: Option<&dyn MapView>,
) -> Option<bool> {
    let members: Vec<Option<bool>> = match value {
        SchemaValue::Array(items) => items
            .iter()
            .map(|member| holds(member, container, view))
            .collect(),
        _ => Vec::new(),
    };

    if keyword == "allOf" {
        return and(&members);
    }

    if members.contains(&Some(true)) {
        return Some(true);
    }

    members
        .iter()
        .all(|member| *member == Some(false))
        .then_some(false)
}
