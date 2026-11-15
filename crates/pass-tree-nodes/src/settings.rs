//! The api settings: conventions, lint rules and allows, packs and services, written to the output.

use seampact_authoring::ApiLayer;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    ConventionValue, IrMap, Lint, LintAllow, LintRule, LintSeverity, Maturity, PackRef, Reason,
    Service, ServiceId,
};
use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue};
use seampact_pass_tree_shared::{
    TREE_NODES_MATURITIES, tree_nodes_member, tree_nodes_written_convention,
};
use seampact_pipeline::{convention_schema_leaves, pipeline_tree_nodes, pointer_below};

use crate::api::text_of;
use crate::pass::TreeNodesScope;

const LINT_SEVERITIES: &[LintSeverity] = &[
    LintSeverity::Disabled,
    LintSeverity::Warning,
    LintSeverity::Error,
];
/// The layer prefix of a pack.
const PACK_LAYER_PREFIX: &str = "pack:";
/// The one rule an allow holds for its node only.
const NODE_ONLY_RULE: &str = "seampact/subtree-exception";
/// The catalogues whose entries take `lint.allow`; an allow there holds for the entry only.
const ALLOWING_CATALOGUES: &[&str] = &[
    "schemes",
    "identities",
    "rights",
    "rules",
    "scopes",
    "schemas",
];
/// The schema positions of a node: an inline schema there holds its own allows.
const ROUTE_SCHEMA_POSITIONS: &[&str] = &["input", "output", "item"];
const ROUTE_FIELDS_MAPS: &[&str] = &["id", "pathParams", "query", "headers"];
const NESTED_SCHEMA_MAPS: &[&str] = &["properties", "oneOf"];
const NESTED_SCHEMA_LISTS: &[&str] = &["allOf", "oneOf"];
const NESTED_SCHEMAS: &[&str] = &["items", "additionalProperties", "contentSchema"];

/// Whether an allow is written on a tree node, which makes it hold for the subtree, or on a catalogue entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AllowOwner {
    Node,
    Entry,
}

/// Adds the allows an owner writes at a pointer.
type AddAllows<'add> = &'add mut dyn FnMut(Option<&JsonObject>, &str, AllowOwner);

/// A mapping, `None` for any other value.
fn object_of(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// Writes `conventions`, `lint`, `packs` and `services` to the output.
pub(crate) fn tree_nodes_api_settings(
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    write_conventions(scope)?;
    scope.output.lint = Some(Lint {
        rules: lint_rules(scope)?,
        allows: lint_allows(scope)?,
    });

    let packs = packs_of(scope)?;

    scope.output.packs.extend(packs);

    write_services(scope)
}

// Written conventions only, keyed by leaf: a core default, or a default read from another key
// (`batch.bodyLimit` from `bodyLimit`), is no written value at that leaf.
fn write_conventions(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), InternalError> {
    let conventions = scope.context.conventions;

    for path in convention_schema_leaves()?.keys() {
        let Some(reading) = tree_nodes_written_convention(*conventions, path)? else {
            continue;
        };

        scope.output.conventions.insert(
            path.clone(),
            ConventionValue {
                value: reading.value.clone(),
                origin: reading.origin,
            },
        );
    }

    Ok(())
}

fn lint_rules(
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<IrMap<String, LintRule>, InternalError> {
    let mut rules = IrMap::new();
    let lint = scope.context.raw.merged.get("lint");
    let Some(written) = object_of(tree_nodes_member(lint, "rules")) else {
        return Ok(rules);
    };

    for (rule, value) in js_key_order(written.iter()) {
        let severity = LINT_SEVERITIES
            .iter()
            .find(|candidate| text_of(Some(value)) == Some(candidate.as_str()));
        let origin = scope.context.origin(&pointer_below("/lint/rules", &[rule]));

        let (Some(severity), Some(origin)) = (severity, origin) else {
            return Err(InternalError::new(format!(
                "the lint rule {rule} has no severity or origin the grammar admits"
            )));
        };

        rules.insert(
            rule.clone(),
            LintRule {
                severity: severity.clone(),
                origin,
            },
        );
    }

    Ok(rules)
}

// Every `lint.allow`: on a tree node (reaching the nodes below it, except the subtree-exception rule), then on a
// catalogue entry, on a property of a declared schema at any depth, and on an inline schema a route writes and its
// properties (holding there only).
fn lint_allows(scope: &TreeNodesScope<'_, '_, '_>) -> Result<Vec<LintAllow>, InternalError> {
    let raw = scope.context.raw;
    let mut allows: Vec<LintAllow> = Vec::new();
    let mut add = |owner: Option<&JsonObject>, pointer: &str, allow_owner: AllowOwner| {
        let written = owner
            .and_then(|owner| object_of(owner.get("lint")))
            .and_then(|lint| object_of(lint.get("allow")));
        let at = scope.context.origin(pointer);

        let (Some(written), Some(at)) = (written, at) else {
            return;
        };

        for (rule, reason) in js_key_order(written.iter()) {
            let Some(reason) = text_of(Some(reason)) else {
                continue;
            };

            allows.push(LintAllow {
                rule: rule.clone(),
                at: at.clone(),
                reason: Reason::new(reason.to_owned()),
                subtree: allow_owner == AllowOwner::Node && rule != NODE_ONLY_RULE,
            });
        }
    };

    for (_, node) in pipeline_tree_nodes(raw)?.iter() {
        add(Some(node.settings), &node.pointer, AllowOwner::Node);
        add_route_position_allows(node.settings, &node.pointer, &mut add);
    }

    for catalogue in ALLOWING_CATALOGUES {
        let Some(entries) = object_of(raw.merged.get(catalogue)) else {
            continue;
        };

        for (id, entry) in js_key_order(entries.iter()) {
            let pointer = pointer_below(&format!("/{catalogue}"), &[id]);

            add(object_of(Some(entry)), &pointer, AllowOwner::Entry);

            if *catalogue == "schemas" {
                add_nested_allows(Some(entry), &pointer, &mut add);
            }
        }
    }

    Ok(allows)
}

fn add_route_position_allows(settings: &JsonObject, pointer: &str, add: AddAllows<'_>) {
    for position in ROUTE_SCHEMA_POSITIONS {
        add_inline_schema_allows(
            settings.get(position),
            &format!("{pointer}/{position}"),
            add,
        );
    }

    for map in ROUTE_FIELDS_MAPS {
        add_fields_map_allows(settings.get(map), &format!("{pointer}/{map}"), add);
    }

    let Some(responses) = object_of(settings.get("responses")) else {
        return;
    };

    for (status, response) in js_key_order(responses.iter()) {
        let at = pointer_below(&format!("{pointer}/responses"), &[status]);

        add_inline_schema_allows(
            tree_nodes_member(Some(response), "body"),
            &format!("{at}/body"),
            add,
        );
        add_fields_map_allows(
            tree_nodes_member(Some(response), "headers"),
            &format!("{at}/headers"),
            add,
        );
    }
}

// A schema name holds no allow of its own; its declaration does.
fn add_inline_schema_allows(schema: Option<&JsonValue>, pointer: &str, add: AddAllows<'_>) {
    let Some(object) = object_of(schema) else {
        return;
    };

    add(Some(object), pointer, AllowOwner::Entry);
    add_nested_allows(schema, pointer, add);
}

fn add_fields_map_allows(fields: Option<&JsonValue>, pointer: &str, add: AddAllows<'_>) {
    let Some(object) = object_of(fields) else {
        return;
    };

    for (name, field) in js_key_order(object.iter()) {
        add_inline_schema_allows(Some(field), &pointer_below(pointer, &[name]), add);
    }
}

// The pack layers in application order (the loader's layer order), each with its manifest's name and version.
fn packs_of(scope: &TreeNodesScope<'_, '_, '_>) -> Result<Vec<PackRef>, InternalError> {
    let mut packs = Vec::new();

    for layer in &scope.context.raw.layers {
        let ApiLayer::Pack(pack) = &layer.layer else {
            continue;
        };
        let manifest = layer.tree.get("pack");
        let name = text_of(tree_nodes_member(manifest, "name"));
        let version = text_of(tree_nodes_member(manifest, "version"));

        let (Some(name), Some(version)) = (name, version) else {
            return Err(InternalError::new(format!(
                "the pack layer {PACK_LAYER_PREFIX}{pack} has no manifest name and version"
            )));
        };

        packs.push(PackRef {
            name: name.to_owned(),
            version: version.to_owned(),
        });
    }

    Ok(packs)
}

fn write_services(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), InternalError> {
    let Some(written) = object_of(scope.context.raw.merged.get("services")) else {
        return Ok(());
    };

    // A service that states no maturity is as mature as the api it serves: the grammar states none for it.
    let api_maturity: Option<Maturity> = scope.output.api.as_ref().map(|api| api.maturity.clone());

    for (id, service) in js_key_order(written.iter()) {
        let stated = TREE_NODES_MATURITIES
            .iter()
            .find(|level| {
                text_of(tree_nodes_member(Some(service), "maturity")) == Some(level.as_str())
            })
            .cloned();
        let maturity = stated.or_else(|| api_maturity.clone());
        let origin = scope.context.origin(&pointer_below("/services", &[id]));

        let (Some(maturity), Some(origin)) = (maturity, origin) else {
            return Err(InternalError::new(format!(
                "the service {id} has no maturity or origin: write the api before its services"
            )));
        };

        scope.output.services.insert(
            ServiceId::new(id.clone()),
            Service {
                id: ServiceId::new(id.clone()),
                maturity,
                origin,
            },
        );
    }

    Ok(())
}

// The allows below a schema: on each property, list item, variant and member, at any depth (ADR 0003).
fn add_nested_allows(schema: Option<&JsonValue>, pointer: &str, add: AddAllows<'_>) {
    for member in NESTED_SCHEMA_MAPS {
        let Some(entries) = object_of(tree_nodes_member(schema, member)) else {
            continue;
        };

        for (key, nested) in js_key_order(entries.iter()) {
            add_inline_schema_allows(Some(nested), &pointer_below(pointer, &[member, key]), add);
        }
    }

    for member in NESTED_SCHEMA_LISTS {
        let Some(JsonValue::Array(entries)) = tree_nodes_member(schema, member) else {
            continue;
        };

        for (index, nested) in entries.iter().enumerate() {
            let position = index.to_string();

            add_inline_schema_allows(
                Some(nested),
                &pointer_below(pointer, &[member, &position]),
                add,
            );
        }
    }

    for member in NESTED_SCHEMAS {
        add_inline_schema_allows(
            tree_nodes_member(schema, member),
            &pointer_below(pointer, &[member]),
            add,
        );
    }
}
