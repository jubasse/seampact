//! Derived objects: `pick` and `omit` merged into the properties of a plain object. A kept property
//! keeps its schema, refinements, marks, docs and origin; `required` replaces the source's list; an
//! overlay replaces the members it sets on one kept property.

use seampact_ir::{FieldRestriction, Property, TypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::raw::TreeSchemasProblem;

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

fn written_strings(value: Option<&JsonValue>) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("writtenStrings"))
}

pub(crate) fn tree_schemas_derived_properties(
    value: &JsonObject,
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<Option<Vec<Property>>, PassError> {
    Err(not_ported_yet("treeSchemasDerivedProperties"))
}

fn kept_properties(
    kind: DerivedKind,
    from: &str,
    source: Vec<Property>,
    fields: &[String],
    pointer: &str,
    host: &mut dyn TreeSchemasDerivedHost,
) -> Result<Option<Vec<Property>>, PassError> {
    Err(not_ported_yet("keptProperties"))
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
