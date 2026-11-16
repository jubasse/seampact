//! Derived objects: `pick` and `omit` merged into the properties of a plain object. A kept property
//! keeps its schema, refinements, marks, docs and origin; `required` replaces the source's list; an
//! overlay replaces the members it sets on one kept property.

use seampact_diagnostics::InternalError;
use seampact_ir::{FieldRestriction, Property, TypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::raw::{
    TreeSchemasProblem, tree_schemas_entries, tree_schemas_member, tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;
use crate::scalars::tree_schemas_mapping_docs;
use crate::use_members::use_members;

/// What the merge asks of the schema compiler.
pub(crate) trait TreeSchemasDerivedHost {
    /// Reports an error at the problem's pointer.
    fn error(&mut self, problem: TreeSchemasProblem) -> Result<(), PassError>;

    /// A copy of the properties of the object schema `name`, or `None` once a problem is reported.
    fn source_properties(
        &mut self,
        name: &str,
        pointer: &str,
    ) -> Result<Option<Vec<Property>>, PassError>;

    fn restriction(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<FieldRestriction, PassError>;

    /// A copy of the examples written on `value`, each queued to be parsed against `schema_use`; `None`
    /// when none.
    fn examples(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<Vec<JsonValue>>, PassError>;

    /// A copy of the default written on `value`, queued to be parsed against `schema_use`; `None` when
    /// none.
    fn default_value(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<JsonValue>, PassError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DerivedKind {
    Pick,
    Omit,
}

impl DerivedKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Pick => "pick",
            Self::Omit => "omit",
        }
    }
}

fn written_strings(value: Option<&JsonValue>) -> Vec<String> {
    let Some(JsonValue::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| match item {
            JsonValue::String(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

pub(crate) fn tree_schemas_derived_properties(
    value: &JsonObject,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<Option<Vec<Property>>, PassError> {
    // validate refuses `pick` beside `omit`.
    let kind = if value.contains_key("pick") {
        DerivedKind::Pick
    } else {
        DerivedKind::Omit
    };
    let spec = value.get(kind.as_str());
    let Some(JsonValue::String(from)) = tree_schemas_member(spec, "from") else {
        return Err(PassError::from(InternalError::new(format!(
            "tree.schemas found no '{}.from' at {pointer}, which validate guarantees",
            kind.as_str()
        ))));
    };
    let source_pointer = tree_schemas_pointer(pointer, &[kind.as_str(), "from"]);

    let Some(source) = host.source_properties(from, &source_pointer)? else {
        return Ok(None);
    };
    let fields = written_strings(tree_schemas_member(spec, "fields"));
    let fields_pointer = tree_schemas_pointer(pointer, &[kind.as_str(), "fields"]);

    let Some(mut kept) = kept_properties(kind, from, source, &fields, &fields_pointer, host)?
    else {
        return Ok(None);
    };

    if !apply_required(value, &mut kept, pointer, host)? {
        return Ok(None);
    }

    Ok(apply_overlays(value, &mut kept, pointer, host)?.then_some(kept))
}

fn kept_properties(
    kind: DerivedKind,
    from: &str,
    source: Vec<Property>,
    fields: &[String],
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<Option<Vec<Property>>, PassError> {
    let mut failed = false;

    for (index, field) in fields.iter().enumerate() {
        let repeated = fields.iter().position(|other| other == field) != Some(index);

        if !repeated && source.iter().any(|property| property.name == *field) {
            continue;
        }

        failed = true;
        host.error(TreeSchemasProblem {
            rule: TreeSchemasRule::DerivedField,
            pointer: tree_schemas_pointer(pointer, &[&index.to_string()]),
            message: if repeated {
                format!("the field '{field}' is listed twice")
            } else {
                format!("'{field}' is no property of the source '{from}'")
            },
            fix: if repeated {
                "list each field once".to_owned()
            } else {
                format!("remove it from 'fields', or declare it on '{from}'")
            },
            related: None,
        })?;
    }

    if failed {
        return Ok(None);
    }

    if kind == DerivedKind::Omit {
        return Ok(Some(
            source
                .into_iter()
                .filter(|property| !fields.contains(&property.name))
                .collect(),
        ));
    }

    Ok(Some(
        fields
            .iter()
            .flat_map(|field| {
                source
                    .iter()
                    .filter(move |property| property.name == *field)
            })
            .cloned()
            .collect(),
    ))
}

/// `required` replaces the source's list for the kept properties; without it each keeps its own.
fn apply_required(
    value: &JsonObject,
    kept: &mut [Property],
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    if !value.contains_key("required") {
        return Ok(true);
    }

    let required = written_strings(value.get("required"));
    let unknown: Vec<&String> = required
        .iter()
        .filter(|name| !kept.iter().any(|property| property.name == **name))
        .collect();

    for name in &unknown {
        host.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RequiredUnknown,
            pointer: tree_schemas_pointer(pointer, &["required"]),
            message: format!("'{name}' is required but is no property the derived object keeps"),
            fix: "keep the property, or remove it from 'required'".to_owned(),
            related: None,
        })?;
    }

    for property in kept.iter_mut() {
        property.optional = !required.contains(&property.name);
    }

    Ok(unknown.is_empty())
}

fn apply_overlays(
    value: &JsonObject,
    kept: &mut [Property],
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    let mut failed = false;

    for (name, overlay) in tree_schemas_entries(value.get("properties")) {
        let at = tree_schemas_pointer(pointer, &["properties", name]);
        let Some(property) = kept.iter_mut().find(|candidate| candidate.name == name) else {
            failed = true;
            host.error(TreeSchemasProblem {
                rule: TreeSchemasRule::DerivedOverlay,
                pointer: at,
                message: format!(
                    "'{name}' is not a property the derived object keeps, so it cannot be overlaid"
                ),
                fix: "overlay a kept property; write a new or different field in full in an 'allOf' beside the derived object".to_owned(),
                related: None,
            })?;

            continue;
        };

        failed = !overlay_property(property, overlay, &at, host)? || failed;
    }

    Ok(!failed)
}

/// The members an overlay sets replace the source's (the authoring schema admits no other key).
fn overlay_property(
    property: &mut Property,
    overlay: &JsonValue,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    let JsonValue::Object(mapping) = overlay else {
        return Ok(true);
    };

    if let Some(JsonValue::Bool(nullable)) = mapping.get("nullable") {
        property.nullable = *nullable;
    }

    if let Some(JsonValue::Bool(deprecated)) = mapping.get("deprecated") {
        property.deprecated = *deprecated;
    }

    if mapping.contains_key("restrictedTo") {
        property.restricted_to = Some(host.restriction(mapping.get("restrictedTo"), pointer)?);
    }

    let overlay_docs = tree_schemas_mapping_docs(mapping);

    if overlay_docs.summary.is_some() {
        property.docs.summary = overlay_docs.summary;
    }

    if overlay_docs.description.is_some() {
        property.docs.description = overlay_docs.description;
    }

    let mut schema_use = property.r#type.clone();

    if property.nullable {
        *use_members(&mut schema_use)?.nullable = Some(true);
    }

    if let Some(examples) = host.examples(overlay, pointer, &schema_use)? {
        property.examples = Some(examples);
    }

    if let Some(defaulted) = host.default_value(overlay, pointer, &schema_use)? {
        property.default = Some(defaulted);
    }

    check_required_overlay(property, mapping, pointer, host)
}

/// A restricted or defaulted property is optional by nature, as on a written property.
fn check_required_overlay(
    property: &Property,
    overlay: &JsonObject,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    if property.optional {
        return Ok(true);
    }

    let mut reasons: Vec<&str> = Vec::new();

    if overlay.contains_key("restrictedTo") {
        reasons.push("a restricted property is optional by nature");
    }

    if overlay.contains_key("default") {
        reasons.push("a default fills an absent property");
    }

    for reason in &reasons {
        host.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RequiredProperty,
            pointer: pointer.to_owned(),
            message: format!("'{}' stays required, but {reason}", property.name),
            fix: "leave it out of 'required'".to_owned(),
            related: None,
        })?;
    }

    Ok(reasons.is_empty())
}
