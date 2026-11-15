//! Derived objects: `pick` and `omit` merged into the properties of a plain object. A kept property
//! keeps its schema, refinements, marks, docs and origin; `required` replaces the source's list; an
//! overlay replaces the members it sets on one kept property.

use seampact_diagnostics::InternalError;
use seampact_ir::{FieldRestriction, Property, TypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::raw::{TreeSchemasProblem, tree_schemas_member, tree_schemas_pointer};
use crate::rule::TreeSchemasRule;

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

fn apply_required(
    value: &JsonObject,
    kept: &mut Vec<Property>,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    Err(not_ported_yet("applyRequired"))
}

fn apply_overlays(
    value: &JsonObject,
    kept: &mut [Property],
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    Err(not_ported_yet("applyOverlays"))
}

fn overlay_property(
    property: &mut Property,
    overlay: &JsonValue,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    Err(not_ported_yet("overlayProperty"))
}

fn check_required_overlay(
    property: &Property,
    overlay: &JsonObject,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkRequiredOverlay"))
}
