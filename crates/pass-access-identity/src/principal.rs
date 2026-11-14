//! The principal of an identity (ADR 0002 section 9): one schema, or one per credential variant,
//! each a named schema (ADR 0004: a `SchemaRef`) whose use the schema service answers (an inline
//! object is hoisted by tree.schemas), and the lookup of a principal field, which every variant
//! must hold. A map or union principal is refused only where a field is read off it (a header
//! use's `from`, a route's `principal.requires`, a binding), by that lookup.

use seampact_ir::{Direction, IrMap, Principal, Schema, SchemaId, SchemaPrincipal, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::{access_identity_is_object, access_identity_member};
use crate::report::{
    AccessIdentityProblem, AccessIdentityRefusal, AccessIdentityReporter, AccessIdentityRule,
};
use crate::schema_use::access_identity_schema_use;

/// A principal resolved, or refused with an error reported.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AccessIdentityPrincipalResult {
    Resolved(Principal),
    Refused,
}

/// Where a dotted field lookup ends: held, missing, or at a step that is no object schema (a map
/// or a union).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AccessIdentityFieldLookup {
    Held,
    Missing,
    NotObject { schema: String, kind: String },
}

// The schema of a schema id in the draft; tree.schemas wrote every schema a use names.
fn schema_of<'draft>(
    _schemas: &'draft IrMap<SchemaId, Schema>,
    _id: &str,
) -> Result<&'draft Schema, PassError> {
    Err(not_ported_yet("schemaOf"))
}

// The named schema a principal position names, or a reported refusal (`None`).
fn principal_schema(
    pointer: &str,
    identity_id: &str,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<Option<SchemaId>, PassError> {
    let schema_use = access_identity_schema_use(schemas, pointer, &Direction::Output)?;

    if let TypeUse::Ref(reference) = &schema_use {
        return Ok(Some(reference.schema.clone()));
    }

    reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::Principal,
        message: format!(
            "the principal of identity '{identity_id}' is an inline schema of kind {}, not a named schema",
            schema_use.tag()
        ),
        fix: "Name an object schema, or write one inline, whose properties are the principal's fields.".to_owned(),
        pointer: pointer.to_owned(),
        related: Vec::new(),
    })?;

    Ok(None)
}

/// The principal of an identity from its raw `principal`, which the caller has found written.
pub(crate) fn access_identity_principal(
    identity_id: &str,
    identity_pointer: &str,
    written: &JsonValue,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<AccessIdentityPrincipalResult, PassError> {
    let pointer = pointer_below(identity_pointer, &["principal"]);
    let variants = access_identity_is_object(Some(written))
        .and_then(|object| access_identity_member(object, "variants"));

    let Some(variants) = variants else {
        let Some(schema) = principal_schema(&pointer, identity_id, schemas, reporter)? else {
            return Ok(AccessIdentityPrincipalResult::Refused);
        };

        return Ok(AccessIdentityPrincipalResult::Resolved(Principal::Schema(
            SchemaPrincipal { schema },
        )));
    };

    variants_principal(identity_id, &pointer, variants, schemas, reporter)
}

fn variants_principal(
    _identity_id: &str,
    _pointer: &str,
    _variants: &JsonValue,
    _schemas: &dyn TreeSchemaService,
    _reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<AccessIdentityPrincipalResult, PassError> {
    Err(not_ported_yet("variantsPrincipal"))
}

/// Whether the schema `id` holds the dotted field path, each step but the last a named object
/// schema.
pub(crate) fn access_identity_schema_field(
    _schemas: &IrMap<SchemaId, Schema>,
    _id: &str,
    _segments: &[&str],
) -> Result<AccessIdentityFieldLookup, PassError> {
    Err(not_ported_yet("accessIdentitySchemaField"))
}

/// Where the lookup of a dotted principal field (`profile.id`) ends, in the first variant that
/// does not hold it.
pub(crate) fn access_identity_principal_field(
    _schemas: &IrMap<SchemaId, Schema>,
    _principal: &Principal,
    _field: &str,
) -> Result<AccessIdentityFieldLookup, PassError> {
    Err(not_ported_yet("accessIdentityPrincipalField"))
}

/// What a reader of a principal field is told when the principal does not hold it.
pub(crate) fn access_identity_principal_field_refusal(
    _reader: &str,
    _field: &str,
    _principal: &Principal,
    _lookup: &AccessIdentityFieldLookup,
) -> Result<AccessIdentityRefusal, PassError> {
    Err(not_ported_yet("accessIdentityPrincipalFieldRefusal"))
}
