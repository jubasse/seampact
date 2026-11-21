//! The IR schema definitions by name, and the walk of an IR instance as the schema reads it.

use std::collections::HashMap;
use std::sync::LazyLock;

use seampact_json::{JsonObject, JsonValue, escape_pointer, js_text_of};

use crate::{IR_SCHEMA_FILES, IrError};

/// The known-values annotation of an open enum (`packages/core/spec/schemas/ir/README.md`).
pub const KNOWN_VALUES_KEYWORD: &str = "x-seampact-known";

/// The must-act annotation of a union or an open enum: an unknown value makes the IR invalid for
/// every reader.
const MUST_ACT_KEYWORD: &str = "x-seampact-must-act";

/// Every definition of the IR schema files by name (names are unique across the files).
static DEFINITIONS: LazyLock<Result<HashMap<String, JsonObject>, String>> =
    LazyLock::new(read_definitions);

fn read_definitions() -> Result<HashMap<String, JsonObject>, String> {
    let mut definitions = HashMap::new();

    for file in IR_SCHEMA_FILES {
        let document: JsonValue = serde_json::from_str(file.text)
            .map_err(|error| format!("the IR schema file {} is not JSON: {error}", file.name))?;
        let JsonValue::Object(mut document) = document else {
            continue;
        };
        let Some(JsonValue::Object(defs)) = document.remove("$defs") else {
            continue;
        };

        for (name, definition) in defs {
            if let JsonValue::Object(definition) = definition {
                definitions.insert(name, definition);
            }
        }
    }

    Ok(definitions)
}

fn broken_schemas(what: String) -> IrError {
    IrError::BrokenSchemas { what }
}

/// The IR schema definition named `name`, or `None` for a name no schema file defines.
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when an embedded schema file is no JSON.
pub fn ir_definition(name: &str) -> Result<Option<&'static JsonObject>, IrError> {
    let definitions = DEFINITIONS
        .as_ref()
        .map_err(|what| broken_schemas(what.clone()))?;

    Ok(definitions.get(name))
}

/// One node of an IR instance, as the schema reads it: an object of a definition, a tagged union
/// object, the value of an open enum, a value present where the schema reads an open enum but not
/// a string, or a string of a named definition (an id, a code, a reason).
#[derive(Debug, Clone, PartialEq)]
pub enum IrInstanceNode<'node> {
    /// An object of a definition (`None` for an object the schema reads without a name).
    Object {
        /// Where the object sits in the instance.
        pointer: &'node str,
        /// The last definition the schema reference chain named.
        definition: Option<&'node str>,
        /// The object.
        value: &'node JsonObject,
    },
    /// An object of a tagged union.
    Union {
        /// Where the object sits in the instance.
        pointer: &'node str,
        /// The tag member: `kind`, or `in`, `verify`, `policy`.
        tag: &'node str,
        /// The tag values of the union's variants, in schema order.
        known: Vec<&'node str>,
        /// Whether an unknown tag makes the IR invalid for every reader.
        must_act: bool,
        /// The object.
        value: &'node JsonObject,
    },
    /// A string where the schema reads an open enum.
    OpenEnum {
        /// Where the value sits in the instance.
        pointer: &'node str,
        /// The known values of the enum.
        known: &'node [JsonValue],
        /// Whether an unknown value makes the IR invalid for every reader.
        must_act: bool,
        /// The value.
        value: &'node str,
    },
    /// A value that is no string where the schema reads an open enum.
    MalformedOpenEnum {
        /// Where the value sits in the instance.
        pointer: &'node str,
        /// The value.
        value: &'node JsonValue,
    },
    /// A string of a named definition (an id, a code, a reason).
    String {
        /// Where the string sits in the instance.
        pointer: &'node str,
        /// The definition the schema reference chain named.
        definition: &'node str,
        /// The string.
        value: &'node str,
    },
}

/// A schema node with its `$ref` chain followed, and the last definition the chain named.
struct Resolved<'schema> {
    node: &'schema JsonObject,
    definition: Option<&'schema str>,
}

fn resolve(node: &JsonObject) -> Result<Resolved<'_>, IrError> {
    let mut definition = None;
    let mut current = node;

    while let Some(JsonValue::String(reference)) = current.get("$ref") {
        let name = reference
            .rsplit_once('/')
            .map_or(reference.as_str(), |(_, name)| name);
        let Some(next) = ir_definition(name)? else {
            return Err(broken_schemas(format!("no IR schema definition {name}")));
        };

        definition = Some(name);
        current = next;
    }

    Ok(Resolved {
        node: current,
        definition,
    })
}

/// The tag value of one union variant, and the variant's schema.
struct VariantTag<'schema> {
    tag: String,
    variant: &'schema JsonObject,
}

// The tag values of a union's variants, in schema order.
fn variant_tags<'schema>(
    variants: &'schema [JsonValue],
    tag: &str,
) -> Result<Vec<VariantTag<'schema>>, IrError> {
    variants
        .iter()
        .map(|variant| {
            let JsonValue::Object(variant) = variant else {
                return Err(broken_schemas(format!(
                    "a variant of the union tagged by {tag} is no schema object"
                )));
            };
            let Some(JsonValue::Object(properties)) = resolve(variant)?.node.get("properties")
            else {
                return Err(broken_schemas(format!(
                    "a variant of the union tagged by {tag} has no properties"
                )));
            };
            let constant = match properties.get(tag) {
                Some(JsonValue::Object(tag_schema)) => tag_schema.get("const"),
                Some(_) | None => None,
            };

            Ok(VariantTag {
                tag: js_text_of(constant),
                variant,
            })
        })
        .collect()
}

/// Visits every IR object, tagged union and open-enum value of `value`, read as `schema`.
///
/// Maps and opaque values are data: their entries are walked, never treated as IR objects. A
/// member the schema does not know, or a union with an unknown tag, is not descended into. Shapes
/// the schema refuses are skipped (the validator reports them).
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when a schema reference names no definition, or whatever `visit`
/// returns.
pub fn walk_ir_instance<'node>(
    value: &'node JsonValue,
    schema: &'node JsonObject,
    pointer: &str,
    visit: &mut impl FnMut(&IrInstanceNode<'_>) -> Result<(), IrError>,
) -> Result<(), IrError> {
    let Resolved { node, definition } = resolve(schema)?;

    if let (Some(JsonValue::Object(discriminator)), Some(JsonValue::Array(variants))) =
        (node.get("discriminator"), node.get("oneOf"))
    {
        let JsonValue::Object(object) = value else {
            return Ok(());
        };
        let tag = js_text_of(discriminator.get("propertyName"));
        let variants = variant_tags(variants, &tag)?;

        visit(&IrInstanceNode::Union {
            pointer,
            tag: &tag,
            known: variants
                .iter()
                .map(|variant| variant.tag.as_str())
                .collect(),
            must_act: is_must_act(node),
            value: object,
        })?;

        let matching = variants.iter().find(|variant| {
            matches!(object.get(&tag), Some(JsonValue::String(text)) if *text == variant.tag)
        });

        if let Some(matching) = matching {
            walk_ir_instance(value, matching.variant, pointer, visit)?;
        }

        return Ok(());
    }

    if let Some(JsonValue::Object(properties)) = node.get("properties") {
        let JsonValue::Object(object) = value else {
            return Ok(());
        };

        visit(&IrInstanceNode::Object {
            pointer,
            definition,
            value: object,
        })?;

        for (member, child) in object {
            if let Some(JsonValue::Object(member_schema)) = properties.get(member) {
                let member_pointer = format!("{pointer}/{}", escape_pointer(member));

                walk_ir_instance(child, member_schema, &member_pointer, visit)?;
            }
        }

        return Ok(());
    }

    if let Some(JsonValue::Object(entry_schema)) = node.get("additionalProperties") {
        let JsonValue::Object(object) = value else {
            return Ok(());
        };

        for (key, child) in object {
            let entry_pointer = format!("{pointer}/{}", escape_pointer(key));

            walk_ir_instance(child, entry_schema, &entry_pointer, visit)?;
        }

        return Ok(());
    }

    let is_array = matches!(node.get("type"), Some(JsonValue::String(kind)) if kind == "array");

    if let (true, Some(JsonValue::Object(item_schema))) = (is_array, node.get("items")) {
        let JsonValue::Array(items) = value else {
            return Ok(());
        };

        for (index, item) in items.iter().enumerate() {
            walk_ir_instance(item, item_schema, &format!("{pointer}/{index}"), visit)?;
        }

        return Ok(());
    }

    let Some(JsonValue::Array(known)) = node.get(KNOWN_VALUES_KEYWORD) else {
        return visit_named_string(node, definition, value, pointer, visit);
    };

    match value {
        JsonValue::String(text) => visit(&IrInstanceNode::OpenEnum {
            pointer,
            known,
            must_act: is_must_act(node),
            value: text,
        }),
        other => visit(&IrInstanceNode::MalformedOpenEnum {
            pointer,
            value: other,
        }),
    }
}

fn is_must_act(node: &JsonObject) -> bool {
    matches!(node.get(MUST_ACT_KEYWORD), Some(JsonValue::Bool(true)))
}

// A string of a definition whose schema is `type: string`: an id, a code, a reason.
fn visit_named_string(
    node: &JsonObject,
    definition: Option<&str>,
    value: &JsonValue,
    pointer: &str,
    visit: &mut impl FnMut(&IrInstanceNode<'_>) -> Result<(), IrError>,
) -> Result<(), IrError> {
    let is_string_type =
        matches!(node.get("type"), Some(JsonValue::String(kind)) if kind == "string");

    match (definition, value) {
        (Some(definition), JsonValue::String(text)) if is_string_type => {
            visit(&IrInstanceNode::String {
                pointer,
                definition,
                value: text,
            })
        }
        _ => Ok(()),
    }
}

/// A tag outside a union's known variants, or a value outside an open enum's known values (ADR
/// 0005 section 3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrUnknown<'node> {
    /// A union tag outside the known variants.
    Kind {
        /// The union object.
        pointer: &'node str,
        /// Its tag member: `kind`, or `in`, `verify`, `policy`.
        tag: &'node str,
        /// The tag value.
        value: &'node str,
    },
    /// A value outside an open enum's known values.
    Value {
        /// Where the value sits in the instance.
        pointer: &'node str,
        /// The value.
        value: &'node str,
    },
}

/// The node's unknown union tag or unknown open-enum value, if it is one: the one reading of
/// "unknown" the closed-declaration check shares with the TypeScript `listIrUnknowns`.
#[must_use]
pub fn visit_ir_unknown<'node>(node: &IrInstanceNode<'node>) -> Option<IrUnknown<'node>> {
    match node {
        IrInstanceNode::Union {
            pointer,
            tag,
            known,
            value,
            ..
        } => match value.get(tag) {
            Some(JsonValue::String(text)) if !known.contains(&text.as_str()) => {
                Some(IrUnknown::Kind {
                    pointer,
                    tag,
                    value: text,
                })
            }
            Some(_) | None => None,
        },
        IrInstanceNode::OpenEnum {
            pointer,
            known,
            value,
            ..
        } => {
            let is_known = known
                .iter()
                .any(|candidate| matches!(candidate, JsonValue::String(text) if text == value));

            (!is_known).then_some(IrUnknown::Value { pointer, value })
        }
        IrInstanceNode::Object { .. }
        | IrInstanceNode::MalformedOpenEnum { .. }
        | IrInstanceNode::String { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn walk_nodes(definition: &str, text: &str) -> Vec<String> {
        let value: JsonValue = serde_json::from_str(text).expect("test json");
        let schema: JsonObject = [(
            "$ref".to_owned(),
            JsonValue::String(format!("#/$defs/{definition}")),
        )]
        .into_iter()
        .collect();
        let mut seen = Vec::new();

        walk_ir_instance(&value, &schema, "", &mut |node| {
            seen.push(match node {
                IrInstanceNode::String {
                    pointer,
                    definition,
                    value,
                } => format!("string {definition} {pointer} {value}"),
                IrInstanceNode::Union {
                    pointer, must_act, ..
                } => format!("union {pointer} {must_act}"),
                IrInstanceNode::OpenEnum {
                    pointer,
                    must_act,
                    value,
                    ..
                } => format!("enum {pointer} {must_act} {value}"),
                IrInstanceNode::Object { pointer, .. } => format!("object {pointer}"),
                IrInstanceNode::MalformedOpenEnum { pointer, .. } => format!("malformed {pointer}"),
            });

            Ok(())
        })
        .expect("walk");

        seen
    }

    #[test]
    fn a_named_string_member_is_visited_with_its_definition() {
        let seen = walk_nodes(
            "ErrorDecl",
            r#"{"origin":{"layer":"core","pointer":"/x"},"params":"api.issue"}"#,
        );

        assert!(
            seen.iter().any(|node| node.starts_with("string ")),
            "visited {seen:?}"
        );
    }

    #[test]
    fn a_must_act_union_and_an_open_enum_carry_their_flag() {
        let seen = walk_nodes(
            "Operation",
            r#"{"access":{"kind":"public"},"method":"GET"}"#,
        );

        assert!(
            seen.iter().any(|node| node.starts_with("union /access ")),
            "visited {seen:?}"
        );
        assert!(
            seen.iter().any(|node| node.starts_with("enum /method ")),
            "visited {seen:?}"
        );
    }
}
