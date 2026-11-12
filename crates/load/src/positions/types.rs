//! The types a schema node accepts, and how nodes combine them.

use std::collections::{BTreeSet, HashSet};

use seampact_json::JsonNumber;

use super::schema_files::SchemaFiles;
use super::schema_node::{SchemaNode, SchemaValue};

/// A JSON Schema type name.
///
/// Variants are declared in the order of their names, which is the order a JavaScript
/// `.sort()` gives them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TypeName {
    /// `array`, a list.
    Array,
    /// `boolean`.
    Boolean,
    /// `integer`.
    Integer,
    /// `null`.
    Null,
    /// `number`.
    Number,
    /// `object`, a mapping.
    Object,
    /// `string`.
    String,
}

/// The types a node accepts, sorted by name.
pub type TypeSet = BTreeSet<TypeName>;

impl TypeName {
    /// The type a schema `type` keyword names, when it is one of the seven (`TYPE_NAMES`).
    pub(super) fn from_keyword(keyword: &str) -> Option<Self> {
        match keyword {
            "array" => Some(Self::Array),
            "boolean" => Some(Self::Boolean),
            "integer" => Some(Self::Integer),
            "null" => Some(Self::Null),
            "number" => Some(Self::Number),
            "object" => Some(Self::Object),
            "string" => Some(Self::String),
            _ => None,
        }
    }

    /// The type as a message says it: `a string`, `an integer`, `a mapping`.
    pub(super) fn words(self) -> &'static str {
        match self {
            Self::Array => "a list",
            Self::Boolean => "a boolean",
            Self::Integer => "an integer",
            Self::Null => "null",
            Self::Number => "a number",
            Self::Object => "a mapping",
            Self::String => "a string",
        }
    }
}

/// The type of a JSON number: an integer when `Number.isInteger` holds, else a number.
pub(super) fn number_type(number: &JsonNumber) -> TypeName {
    if number.is_integer() {
        TypeName::Integer
    } else {
        TypeName::Number
    }
}

/// The type of a value written in a schema, for `enum` and `const` (`valueType`).
///
/// Total: a parsed JSON value is always one of the seven.
fn value_type(value: &SchemaValue) -> TypeName {
    match value {
        SchemaValue::Null => TypeName::Null,
        SchemaValue::String(_) => TypeName::String,
        SchemaValue::Bool(_) => TypeName::Boolean,
        SchemaValue::Number(number) => number_type(number),
        SchemaValue::Array(_) => TypeName::Array,
        SchemaValue::Object(_) => TypeName::Object,
    }
}

/// The types of several alternatives together: none as soon as one states no type.
fn union(parts: Vec<Option<TypeSet>>) -> Option<TypeSet> {
    let mut out = TypeSet::new();

    for part in parts {
        out.extend(part?);
    }

    Some(out)
}

/// The types two constraints that both hold leave (`intersect`).
///
/// `a` and `b` that state no type add nothing; an integer is a number, so `integer` and `number`
/// leave `integer`; contradictory constraints leave no reading, for the validate stage to report.
pub(super) fn intersect(a: Option<TypeSet>, b: Option<TypeSet>) -> Option<TypeSet> {
    let (a, b) = match (a, b) {
        (None, other) | (other, None) => return other,
        (Some(a), Some(b)) => (a, b),
    };
    let mut out = TypeSet::new();

    for x in &a {
        for y in &b {
            if x == y {
                out.insert(*x);
            } else if is_integer_with_number(*x, *y) {
                out.insert(TypeName::Integer);
            }
        }
    }

    if out.is_empty() { None } else { Some(out) }
}

fn is_integer_with_number(x: TypeName, y: TypeName) -> bool {
    matches!(
        (x, y),
        (TypeName::Integer, TypeName::Number) | (TypeName::Number, TypeName::Integer)
    )
}

/// What one node accepts: its own `type`, `enum` and `const`, its `$ref`, every `allOf` member
/// (all must hold), the union of `anyOf` and `oneOf` members and of the `then` and `else`
/// branches (a missing branch accepts anything). `None` when it states no type.
pub(super) fn types_of(files: &SchemaFiles, node: &SchemaNode) -> Option<TypeSet> {
    types_of_unless_visiting(files, node, &mut HashSet::new())
}

/// [`types_of`] that answers `None` for a node it is already reading: a reference cycle.
fn types_of_unless_visiting(
    files: &SchemaFiles,
    node: &SchemaNode,
    resolving: &mut HashSet<SchemaNode>,
) -> Option<TypeSet> {
    if !resolving.insert(node.clone()) {
        return None;
    }

    let types = stated_types(files, node, resolving);

    resolving.remove(node);

    types
}

fn stated_types(
    files: &SchemaFiles,
    node: &SchemaNode,
    resolving: &mut HashSet<SchemaNode>,
) -> Option<TypeSet> {
    let mut types = keyword_types(node);

    if let Some(values) = node.list_member("enum") {
        types = intersect(types, Some(values.iter().map(value_type).collect()));
    }

    if let Some(constant) = node.member("const") {
        types = intersect(types, Some(TypeSet::from([value_type(constant)])));
    }

    if let Some(target) = files.referenced(node) {
        let target_types = types_of_unless_visiting(files, &target, resolving);

        types = intersect(types, target_types);
    }

    for member in node.subschemas("allOf") {
        let member_types = types_of_unless_visiting(files, &member, resolving);

        types = intersect(types, member_types);
    }

    for key in ["anyOf", "oneOf"] {
        if node.member(key).is_some() {
            let alternatives = node
                .subschemas(key)
                .iter()
                .map(|member| types_of_unless_visiting(files, member, resolving))
                .collect();

            types = intersect(types, union(alternatives));
        }
    }

    if node.node_member("if").is_some() {
        let branches = ["then", "else"]
            .map(|key| branch_types(files, node, key, resolving))
            .into();

        types = intersect(types, union(branches));
    }

    types
}

/// The types the `type` keyword states: one name, or the names of a list that are known.
fn keyword_types(node: &SchemaNode) -> Option<TypeSet> {
    match node.member("type")? {
        SchemaValue::String(name) => {
            TypeName::from_keyword(name).map(|known| TypeSet::from([known]))
        }
        SchemaValue::Array(names) => Some(
            names
                .iter()
                .filter_map(|name| match name {
                    SchemaValue::String(text) => TypeName::from_keyword(text),
                    _ => None,
                })
                .collect(),
        ),
        _ => None,
    }
}

/// The types of a `then` or `else` branch; `None` for a missing branch, which accepts anything.
fn branch_types(
    files: &SchemaFiles,
    node: &SchemaNode,
    key: &str,
    resolving: &mut HashSet<SchemaNode>,
) -> Option<TypeSet> {
    let branch = node.subschemas(key).into_iter().next()?;

    types_of_unless_visiting(files, &branch, resolving)
}
