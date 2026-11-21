//! Consumer extension keys: each declared under a prefix with a schema and the places it may sit,
//! written `x-<prefix>-<key>` there. Every written value is parsed against its declaration's schema
//! like an example; an undeclared key, or one outside its places, is refused at the key.

use std::collections::HashMap;

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    ExtensionKey, ExtensionKeyDecl, ExtensionKeyId, ExtensionPlace, ExtensionPrefix, Extensions,
    IrMap,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_pass_tree_shared::extension_key_parts;
use seampact_pipeline::{PassError, TreeNodes};

use crate::compile::{
    TreeSchemasCompiler, TreeSchemasExampleCheck, TreeSchemasPlace, TreeSchemasPosition,
    TreeSchemasWrittenValue,
};
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, tree_schemas_entries, tree_schemas_member,
    tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

/// A mapping holding written extension values, and the place of the IR element they extend.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasExtensionHolder<'raw> {
    pub(crate) pointer: String,
    pub(crate) value: &'raw JsonObject,
    /// `None` for a schema mapping that writes no IR element (an inlined scalar, array or enum
    /// use).
    pub(crate) place: Option<ExtensionPlace>,
}

/// Where the written values are read: the merged raw tree and the nodes of its surfaces.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TreeSchemasExtensionSite<'tree, 'raw> {
    pub(crate) merged: &'raw JsonObject,
    pub(crate) nodes: &'tree TreeNodes<'raw>,
}

/// The places an extension key may be declared for.
const PLACES: [ExtensionPlace; 7] = [
    ExtensionPlace::Api,
    ExtensionPlace::Operation,
    ExtensionPlace::Schema,
    ExtensionPlace::Property,
    ExtensionPlace::Right,
    ExtensionPlace::Rule,
    ExtensionPlace::Scope,
];

fn is_place(value: &str) -> bool {
    ExtensionPlace::known(value).is_some_and(|place| PLACES.contains(&place))
}

/// Whether a mapping writes any extension key.
pub(crate) fn tree_schemas_has_extensions(value: &JsonObject) -> bool {
    value.keys().any(|key| extension_key_parts(key).is_some())
}

/// The IR slot `{ <prefix>: { <key>: value } }` of the extension values a mapping writes, each
/// copied.
pub(crate) fn tree_schemas_extension_slot(value: &JsonObject) -> Extensions {
    let mut slot = Extensions::new();

    for (written, member) in value {
        let Some((prefix, key)) = extension_key_parts(written) else {
            continue;
        };
        let prefix = ExtensionPrefix::new(prefix.to_owned());
        let key = ExtensionKey::new(key.to_owned());

        match slot.get_mut(&prefix) {
            Some(keys) => {
                keys.insert(key, member.clone());
            }
            None => {
                slot.insert(prefix, IrMap::from_iter([(key, member.clone())]));
            }
        }
    }

    slot
}

pub(crate) fn tree_schemas_compile_extension_keys<'raw>(
    compiler: &mut TreeSchemasCompiler<'raw, '_, '_>,
    merged: &'raw JsonObject,
) -> Result<Vec<ExtensionKeyDecl>, PassError> {
    let mut declarations = Vec::new();

    for (prefix, keys) in tree_schemas_entries(merged.get("extensions")) {
        for (key, declaration) in tree_schemas_entries(Some(keys)) {
            let pointer = tree_schemas_pointer("/extensions", &[prefix, key]);
            let schema_pointer = tree_schemas_pointer(&pointer, &["schema"]);
            let Some(schema) = tree_schemas_member(Some(declaration), "schema") else {
                continue;
            };
            let at = tree_schemas_member(Some(declaration), "at");

            compiler.position(
                schema,
                &TreeSchemasPosition {
                    pointer: schema_pointer.clone(),
                    name: None,
                    place: TreeSchemasPlace::Position,
                    id: None,
                },
                &[],
            )?;

            let Some(schema_use) = compiler.uses.get(&schema_pointer) else {
                continue;
            };
            let schema_use = schema_use.clone();
            let places = written_places(at)?;

            declarations.push(ExtensionKeyDecl {
                id: ExtensionKeyId::new(format!("{prefix}-{key}")),
                prefix: ExtensionPrefix::new(prefix.to_owned()),
                key: ExtensionKey::new(key.to_owned()),
                schema: schema_use,
                places,
                origin: compiler.reporter.origin(&pointer)?,
            });
        }
    }

    Ok(declarations)
}

// The written `at` entries that name a place; any other entry is left out.
fn written_places(at: Option<&JsonValue>) -> Result<Vec<ExtensionPlace>, PassError> {
    let Some(JsonValue::Array(written)) = at else {
        return Ok(Vec::new());
    };
    let mut places = Vec::new();

    for entry in written {
        let JsonValue::String(text) = entry else {
            continue;
        };

        if !is_place(text) {
            continue;
        }

        let place = ExtensionPlace::known(text).ok_or_else(|| {
            InternalError::new(format!(
                "the extension place {text} is known to isPlace only"
            ))
        })?;

        places.push(place);
    }

    Ok(places)
}

fn catalogue_holders<'raw>(
    merged: &'raw JsonObject,
    nodes: &TreeNodes<'raw>,
) -> Vec<TreeSchemasExtensionHolder<'raw>> {
    let mut holders = Vec::new();

    if let Some(JsonValue::Object(api)) = merged.get("api") {
        holders.push(TreeSchemasExtensionHolder {
            pointer: "/api".to_owned(),
            value: api,
            place: Some(ExtensionPlace::Api),
        });
    }

    for (_, node) in nodes.iter() {
        holders.push(TreeSchemasExtensionHolder {
            pointer: node.pointer.clone(),
            value: node.settings,
            place: Some(ExtensionPlace::Operation),
        });
    }

    for (catalogue, place) in [
        ("rights", ExtensionPlace::Right),
        ("rules", ExtensionPlace::Rule),
        ("scopes", ExtensionPlace::Scope),
    ] {
        for (id, value) in tree_schemas_entries(merged.get(catalogue)) {
            if let JsonValue::Object(object) = value {
                holders.push(TreeSchemasExtensionHolder {
                    pointer: tree_schemas_pointer(&format!("/{catalogue}"), &[id]),
                    value: object,
                    place: Some(place.clone()),
                });
            }
        }
    }

    holders
}

fn places_text(places: &[ExtensionPlace]) -> String {
    if places.is_empty() {
        return "no place".to_owned();
    }

    let names: Vec<&str> = places.iter().map(ExtensionPlace::as_str).collect();

    names.join(", ")
}

pub(crate) fn tree_schemas_check_extension_values(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    declarations: &[ExtensionKeyDecl],
    site: TreeSchemasExtensionSite<'_, '_>,
) -> Result<(), PassError> {
    let by_key: HashMap<String, &ExtensionKeyDecl> = declarations
        .iter()
        .map(|declared| (format!("x-{}", declared.id.as_str()), declared))
        .collect();
    let catalogue = catalogue_holders(site.merged, site.nodes);

    for holder in catalogue.iter().chain(compiler.extension_holders.values()) {
        for (key, written) in holder.value {
            if extension_key_parts(key).is_none() {
                continue;
            }

            let at = tree_schemas_pointer(&holder.pointer, &[key]);
            let Some(declared) = by_key.get(key) else {
                compiler.reporter.error(TreeSchemasProblem {
                    rule: TreeSchemasRule::ExtensionUnknown,
                    pointer: at,
                    message: format!("{} is no declared extension key", quote_text(key)),
                    fix: "declare it under 'extensions' with its schema and places, or remove it"
                        .to_owned(),
                    related: None,
                })?;

                continue;
            };

            let fits_place = holder
                .place
                .as_ref()
                .is_some_and(|place| declared.places.contains(place));

            if !fits_place {
                let problem = extension_place_problem(key, at, holder.place.as_ref(), declared);

                compiler.reporter.error(problem)?;

                continue;
            }

            compiler.example_checks.push(TreeSchemasExampleCheck {
                pointer: at,
                value: written.clone(),
                schema_use: declared.schema.clone(),
                written: TreeSchemasWrittenValue::Extension,
            });
        }
    }

    Ok(())
}

fn extension_place_problem(
    key: &str,
    pointer: String,
    place: Option<&ExtensionPlace>,
    declared: &ExtensionKeyDecl,
) -> TreeSchemasProblem {
    let allowed = places_text(&declared.places);
    let quoted = quote_text(key);
    let (message, fix) = match place {
        None => (
            format!(
                "{quoted} may sit on {allowed}, and this mapping is no place an extension extends"
            ),
            "move it to a place its 'at' lists, or remove it".to_owned(),
        ),
        Some(place) => (
            format!("{quoted} may sit on {allowed}, not on {place}"),
            format!("add '{place}' to its 'at', or move it"),
        ),
    };

    TreeSchemasProblem {
        rule: TreeSchemasRule::ExtensionPlace,
        pointer,
        message,
        fix,
        related: Some(vec![TreeSchemasRelated {
            pointer: tree_schemas_pointer(
                "/extensions",
                &[declared.prefix.as_str(), declared.key.as_str()],
            ),
            message: "its declaration".to_owned(),
        }]),
    }
}
