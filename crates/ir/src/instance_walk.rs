//! The IR schema definitions by name, and the walk of an IR instance as the schema reads it.

use std::collections::HashMap;
use std::sync::LazyLock;

use seampact_json::{JsonObject, JsonValue, escape_pointer, js_text_of};

use crate::{IR_SCHEMA_FILES, IrError};

/// The known-values annotation of an open enum (`packages/core/spec/schemas/ir/README.md`).
const KNOWN_VALUES_KEYWORD: &str = "x-seampact-known";

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
pub(crate) fn ir_definition(name: &str) -> Result<Option<&'static JsonObject>, IrError> {
    let definitions = DEFINITIONS
        .as_ref()
        .map_err(|what| broken_schemas(what.clone()))?;

    Ok(definitions.get(name))
}

/// One node of an IR instance, as the schema reads it: an object of a definition, a tagged union
/// object, the value of an open enum, or a value present where the schema reads an open enum but
/// not a string.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum IrInstanceNode<'node> {
    Object {
        pointer: &'node str,
        definition: Option<&'node str>,
        value: &'node JsonObject,
    },
    Union {
        pointer: &'node str,
        tag: &'node str,
        known: Vec<&'node str>,
        value: &'node JsonObject,
    },
    OpenEnum {
        pointer: &'node str,
        known: &'node [JsonValue],
        value: &'node str,
    },
    MalformedOpenEnum {
        pointer: &'node str,
        value: &'node JsonValue,
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
/// the schema refuses are skipped (the validator reports them). Named-string nodes are not
/// visited: no Rust caller reads them.
pub(crate) fn walk_ir_instance<'node>(
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
        return Ok(());
    };

    match value {
        JsonValue::String(text) => visit(&IrInstanceNode::OpenEnum {
            pointer,
            known,
            value: text,
        }),
        other => visit(&IrInstanceNode::MalformedOpenEnum {
            pointer,
            value: other,
        }),
    }
}

/// A tag outside a union's known variants, or a value outside an open enum's known values (ADR
/// 0005 section 3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IrUnknown<'node> {
    Kind {
        /// The union object.
        pointer: &'node str,
        /// Its tag member: `kind`, or `in`, `verify`, `policy`.
        tag: &'node str,
        value: &'node str,
    },
    Value {
        pointer: &'node str,
        value: &'node str,
    },
}

/// The node's unknown union tag or unknown open-enum value, if it is one: the one reading of
/// "unknown" the closed-declaration check shares with the TypeScript `listIrUnknowns`.
pub(crate) fn visit_ir_unknown<'node>(node: &IrInstanceNode<'node>) -> Option<IrUnknown<'node>> {
    match node {
        IrInstanceNode::Union {
            pointer,
            tag,
            known,
            value,
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
        } => {
            let is_known = known
                .iter()
                .any(|candidate| matches!(candidate, JsonValue::String(text) if text == value));

            (!is_known).then_some(IrUnknown::Value { pointer, value })
        }
        IrInstanceNode::Object { .. } | IrInstanceNode::MalformedOpenEnum { .. } => None,
    }
}
