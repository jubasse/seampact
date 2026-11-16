//! The closed-declaration check: an IR declaration read in the open form holds only what this IR
//! revision knows, so a pass may copy it into the IR it writes.

use seampact_js::utf16_prefix;
use seampact_json::{JsonObject, JsonValue, escape_pointer, json_at_pointer};

use crate::instance_walk::{
    IrInstanceNode, IrUnknown, ir_definition, visit_ir_unknown, walk_ir_instance,
};
use crate::{
    Enum, ExtensionKeyDecl, IrError, Operation, PagingStyle, Scalar, Schema, TypeUse, WireFormat,
};

mod sealed {
    /// Keeps [`super::IrClosedDeclaration`] to the definitions this crate lists.
    pub trait Sealed {}
}

/// A declaration a compiler pass may copy from an IR it read into the IR it writes.
///
/// Implemented for the eight definitions the TypeScript `IrClosedDeclarations` lists, and sealed.
pub trait IrClosedDeclaration: sealed::Sealed {
    /// The definition name of the IR schema files.
    const DEFINITION: &'static str;
}

macro_rules! closed_declarations {
    ($($declaration:ident,)+) => {
        $(
            impl sealed::Sealed for $declaration {}

            impl IrClosedDeclaration for $declaration {
                const DEFINITION: &'static str = stringify!($declaration);
            }
        )+
    };
}

closed_declarations! {
    Schema,
    Enum,
    Scalar,
    WireFormat,
    ExtensionKeyDecl,
    PagingStyle,
    Operation,
    TypeUse,
}

/// A union tag, an open-enum value or a member name outside what this IR revision knows.
///
/// The tag is reported at the tag member's pointer, a member name at the member's pointer with
/// the name as the value. A tag or open-enum value that is missing or not a string has its kind
/// as the value. The value and a member name in the pointer are bounded: they are read from an
/// untrusted document.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IrClosedUnknown {
    /// Where the unknown is, below the pointer the check was given.
    pub pointer: String,
    /// The unknown, bounded.
    pub value: String,
}

/// The answer of [`check_ir_closed_declaration`].
#[derive(Debug, Clone, PartialEq)]
pub enum IrClosedCheck<'declaration, T> {
    /// The declaration holds only what this IR revision knows: every union inside it narrows to
    /// its `Known` form.
    Closed(&'declaration T),
    /// Every unknown the declaration holds, in the order of a walk of the IR file; never empty.
    Unknowns(Vec<IrClosedUnknown>),
}

/// The length an echoed unknown string is cut to, in UTF-16 code units.
const MAX_UNKNOWN_VALUE_LENGTH: usize = 64;

/// The mark of a cut unknown string.
const ELLIPSIS: &str = "...";

/// A string cut to the bound of an echoed unknown.
#[must_use]
pub fn bounded_unknown_text(text: &str) -> String {
    if text.encode_utf16().count() <= MAX_UNKNOWN_VALUE_LENGTH {
        return text.to_owned();
    }

    format!("{}{ELLIPSIS}", utf16_prefix(text, MAX_UNKNOWN_VALUE_LENGTH))
}

/// A string cut to the bound; any other value replaced by its kind, `undefined` when absent.
#[must_use]
pub fn bounded_unknown_value(value: Option<&JsonValue>) -> String {
    let kind = match value {
        Some(JsonValue::String(text)) => return bounded_unknown_text(text),
        Some(JsonValue::Null) => "null",
        Some(JsonValue::Array(_)) => "array",
        Some(JsonValue::Bool(_)) => "boolean",
        Some(JsonValue::Number(_)) => "number",
        Some(JsonValue::Object(_)) => "object",
        None => "undefined",
    };

    kind.to_owned()
}

fn push_unknown(unknowns: &mut Vec<IrClosedUnknown>, pointer: String, value: String) {
    unknowns.push(IrClosedUnknown { pointer, value });
}

fn push_unknown_members(
    definition: Option<&str>,
    value: &JsonObject,
    pointer: &str,
    unknowns: &mut Vec<IrClosedUnknown>,
) -> Result<(), IrError> {
    let Some(definition) = definition else {
        return Ok(());
    };
    let Some(JsonValue::Object(properties)) =
        ir_definition(definition)?.and_then(|schema| schema.get("properties"))
    else {
        return Ok(());
    };

    for member in value.keys() {
        if !properties.contains_key(member) {
            let bounded = bounded_unknown_text(member);
            let member_pointer = format!("{pointer}/{}", escape_pointer(&bounded));

            push_unknown(unknowns, member_pointer, bounded);
        }
    }

    Ok(())
}

fn push_node_unknowns(
    node: &IrInstanceNode<'_>,
    unknowns: &mut Vec<IrClosedUnknown>,
) -> Result<(), IrError> {
    match visit_ir_unknown(node) {
        Some(IrUnknown::Kind {
            pointer,
            tag,
            value,
        }) => push_unknown(
            unknowns,
            format!("{pointer}/{tag}"),
            bounded_unknown_text(value),
        ),
        Some(IrUnknown::Value { pointer, value }) => {
            push_unknown(unknowns, pointer.to_owned(), bounded_unknown_text(value));
        }
        None => {}
    }

    match node {
        IrInstanceNode::Union {
            pointer,
            tag,
            value,
            ..
        } => {
            let tag_value = value.get(tag);

            if !matches!(tag_value, Some(JsonValue::String(_))) {
                push_unknown(
                    unknowns,
                    format!("{pointer}/{tag}"),
                    bounded_unknown_value(tag_value),
                );
            }
        }
        IrInstanceNode::MalformedOpenEnum { pointer, value } => {
            push_unknown(
                unknowns,
                (*pointer).to_owned(),
                bounded_unknown_value(Some(value)),
            );
        }
        IrInstanceNode::Object {
            pointer,
            definition,
            value,
        } => push_unknown_members(*definition, value, pointer, unknowns)?,
        IrInstanceNode::OpenEnum { .. } | IrInstanceNode::String { .. } => {}
    }

    Ok(())
}

/// Every unknown of `declaration`, read as the definition `definition`, below `pointer`.
fn closed_unknowns(
    definition: &str,
    declaration: &JsonValue,
    pointer: &str,
) -> Result<Vec<IrClosedUnknown>, IrError> {
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(format!("#/$defs/{definition}")),
    )]
    .into_iter()
    .collect();
    let mut unknowns = Vec::new();

    walk_ir_instance(declaration, &schema, pointer, &mut |node| {
        push_node_unknowns(node, &mut unknowns)
    })?;

    Ok(unknowns)
}

/// Checks that a declaration read in the open form (an imported api's IR) holds only what this
/// IR revision knows: every union tag a known variant, every open-enum value a known value, every
/// object member one the schema declares (a member name is reported as the value), and every tag
/// and open-enum value present as a string.
///
/// The check reads the declaration in `document`, the IR document it was decoded from, at
/// `pointer`: the typed form drops an unknown member on decode, the document keeps it. When it
/// holds, `declaration` is answered as given, for the caller to copy before storing it; else
/// every unknown, with its pointer below `pointer`, for the caller to refuse by name.
///
/// # Errors
///
/// [`IrError::DeclarationNotInDocument`] when `pointer` names nothing in `document`, and
/// [`IrError::BrokenSchemas`] when the embedded IR schemas do not read as the walk expects.
pub fn check_ir_closed_declaration<'declaration, T: IrClosedDeclaration>(
    declaration: &'declaration T,
    document: &JsonValue,
    pointer: &str,
) -> Result<IrClosedCheck<'declaration, T>, IrError> {
    let Some(read) = json_at_pointer(document, pointer) else {
        return Err(IrError::DeclarationNotInDocument {
            pointer: pointer.to_owned(),
        });
    };
    let unknowns = closed_unknowns(T::DEFINITION, read, pointer)?;

    if unknowns.is_empty() {
        return Ok(IrClosedCheck::Closed(declaration));
    }

    Ok(IrClosedCheck::Unknowns(unknowns))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const EVERY_MEMBER_EXAMPLE: &str =
        include_str!("../../../packages/core/spec/schemas/ir/examples/every-member.ir.json");

    fn declaration_at(pointer: &str) -> serde_json::Value {
        let example: serde_json::Value = serde_json::from_str(EVERY_MEMBER_EXAMPLE).unwrap();

        example.pointer(pointer).unwrap().clone()
    }

    fn unknowns_of(
        definition: &str,
        declaration: serde_json::Value,
        pointer: &str,
    ) -> Vec<IrClosedUnknown> {
        let instance = JsonValue::try_from(declaration).unwrap();

        closed_unknowns(definition, &instance, pointer).unwrap()
    }

    fn unknown(pointer: &str, value: &str) -> IrClosedUnknown {
        IrClosedUnknown {
            pointer: pointer.to_owned(),
            value: value.to_owned(),
        }
    }

    #[test]
    fn a_member_the_schema_does_not_know_is_reported_at_its_pointer() {
        let mut task = declaration_at("/schemas/Task");
        let mut style = declaration_at("/pagings/cursor");

        task["x-extra"] = json!(1);
        style["zzLater"] = json!(true);

        assert_eq!(
            unknowns_of("Schema", task, "/schemas/Task"),
            vec![unknown("/schemas/Task/x-extra", "x-extra")]
        );
        assert_eq!(
            unknowns_of("PagingStyle", style, "/pagings/cursor"),
            vec![unknown("/pagings/cursor/zzLater", "zzLater")]
        );
    }

    #[test]
    fn a_member_name_is_cut_to_the_bound_in_the_pointer_and_the_value() {
        let mut task = declaration_at("/schemas/Task");

        task["m".repeat(500)] = json!(1);

        let cut = format!("{}...", "m".repeat(64));

        assert_eq!(
            unknowns_of("Schema", task, "/schemas/Task"),
            vec![unknown(&format!("/schemas/Task/{cut}"), &cut)]
        );
    }

    #[test]
    fn a_missing_or_non_string_union_tag_is_reported_by_its_kind() {
        let task = declaration_at("/schemas/Task");
        let mut without_kind = task.clone();
        let mut numbered = task;

        without_kind.as_object_mut().unwrap().remove("kind");
        numbered["kind"] = json!(5);

        assert_eq!(
            unknowns_of("Schema", without_kind, "/schemas/Task"),
            vec![unknown("/schemas/Task/kind", "undefined")]
        );
        assert_eq!(
            unknowns_of("Schema", numbered, "/schemas/Task"),
            vec![unknown("/schemas/Task/kind", "number")]
        );
    }

    #[test]
    fn a_non_string_open_enum_value_is_reported_by_its_kind() {
        let mut money = declaration_at("/scalars/money");

        money["directions"] = json!(["input", 7, {"deep": "x".repeat(500)}, null, [], false]);

        assert_eq!(
            unknowns_of("Scalar", money, "/scalars/money"),
            vec![
                unknown("/scalars/money/directions/1", "number"),
                unknown("/scalars/money/directions/2", "object"),
                unknown("/scalars/money/directions/3", "null"),
                unknown("/scalars/money/directions/4", "array"),
                unknown("/scalars/money/directions/5", "boolean"),
            ]
        );
    }

    #[test]
    fn the_bound_counts_utf16_units_and_replaces_a_split_surrogate_pair() {
        let astral = "\u{1F600}".repeat(40);
        let mixed = format!("{}\u{1F600}", "a".repeat(63));

        assert_eq!(
            bounded_unknown_text(&"\u{1F600}".repeat(32)),
            "\u{1F600}".repeat(32)
        );
        assert_eq!(
            bounded_unknown_text(&astral),
            format!("{}...", "\u{1F600}".repeat(32))
        );
        assert_eq!(
            bounded_unknown_text(&mixed),
            format!("{}\u{FFFD}...", "a".repeat(63))
        );
    }
}
