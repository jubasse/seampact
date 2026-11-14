//! The principal of an identity (ADR 0002 section 9): one schema, or one per credential variant,
//! each a named schema (ADR 0004: a `SchemaRef`) whose use the schema service answers (an inline
//! object is hoisted by tree.schemas), and the lookup of a principal field, which every variant
//! must hold. A map or union principal is refused only where a field is read off it (a header
//! use's `from`, a route's `principal.requires`, a binding), by that lookup.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Direction, IrMap, KnownPrincipal, KnownPrincipalRef, KnownSchemaRef, Schema, SchemaId,
    SchemaPrincipal, TypeUse, VariantId, VariantsPrincipal,
};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::read::{access_identity_is_object, access_identity_member};
use crate::report::{
    AccessIdentityProblem, AccessIdentityRefusal, AccessIdentityReporter, AccessIdentityRule,
};
use crate::schema_use::access_identity_schema_use;

/// A principal resolved, or refused with an error reported.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AccessIdentityPrincipalResult {
    Resolved(KnownPrincipal),
    Refused,
}

/// Where a dotted field lookup that does not find the field ends: the field is missing, or a step
/// is no object schema (a map or a union).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AccessIdentityFieldFault {
    Missing,
    NotObject { schema: String, kind: String },
}

// The schema of a schema id in the draft; tree.schemas wrote every schema a use names.
fn schema_of<'draft>(
    schemas: &'draft IrMap<SchemaId, Schema>,
    id: &str,
) -> Result<&'draft Schema, InternalError> {
    schemas.get(id).ok_or_else(|| {
        InternalError::new(format!(
            "the schema service answered a use of {id}, which the draft has no schema for"
        ))
    })
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

        return Ok(AccessIdentityPrincipalResult::Resolved(
            KnownPrincipal::Schema(SchemaPrincipal { schema }),
        ));
    };

    variants_principal(identity_id, &pointer, variants, schemas, reporter)
}

fn variants_principal(
    identity_id: &str,
    pointer: &str,
    variants: &JsonValue,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<AccessIdentityPrincipalResult, PassError> {
    let names: Vec<&String> = access_identity_is_object(Some(variants))
        .map(|object| object.keys().collect())
        .unwrap_or_default();

    if names.is_empty() {
        reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::Principal,
            message: format!("the principal of identity '{identity_id}' lists no variant"),
            fix: "Name one schema per credential variant, as 'variants: { <name>: <schema> }', or name one schema.".to_owned(),
            pointer: pointer_below(pointer, &["variants"]),
            related: Vec::new(),
        })?;

        return Ok(AccessIdentityPrincipalResult::Refused);
    }

    let mut resolved = IrMap::new();
    let mut refused = false;

    for name in names {
        let variant_pointer = pointer_below(pointer, &["variants", name]);
        let schema = principal_schema(&variant_pointer, identity_id, schemas, reporter)?;

        match schema {
            None => refused = true,
            Some(schema) => {
                resolved.insert(VariantId::new(name.clone()), schema);
            }
        }
    }

    if refused {
        return Ok(AccessIdentityPrincipalResult::Refused);
    }

    Ok(AccessIdentityPrincipalResult::Resolved(
        KnownPrincipal::Variants(VariantsPrincipal { variants: resolved }),
    ))
}

/// Where the lookup of the dotted field path in the schema `id` fails, `None` when it holds it,
/// each step but the last a named object schema.
///
/// # Errors
///
/// An internal error for a schema the draft does not hold.
pub(crate) fn access_identity_schema_field(
    schemas: &IrMap<SchemaId, Schema>,
    id: &str,
    segments: &[&str],
) -> Result<Option<AccessIdentityFieldFault>, InternalError> {
    let schema = schema_of(schemas, id)?;

    let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
        return Ok(Some(AccessIdentityFieldFault::NotObject {
            schema: id.to_owned(),
            kind: schema.tag().to_owned(),
        }));
    };

    let Some((first, rest)) = segments.split_first() else {
        return Ok(Some(AccessIdentityFieldFault::Missing));
    };
    let property = object
        .properties
        .iter()
        .find(|candidate| candidate.name == *first);

    let Some(property) = property else {
        return Ok(Some(AccessIdentityFieldFault::Missing));
    };

    if rest.is_empty() {
        return Ok(None);
    }

    let TypeUse::Ref(reference) = &property.r#type else {
        return Ok(Some(AccessIdentityFieldFault::Missing));
    };

    access_identity_schema_field(schemas, reference.schema.as_str(), rest)
}

/// Where the lookup of a dotted principal field (`profile.id`) fails, in the first variant that
/// does not hold it; `None` when every variant does.
///
/// # Errors
///
/// An internal error for a schema the draft does not hold.
pub(crate) fn access_identity_principal_field(
    schemas: &IrMap<SchemaId, Schema>,
    principal: KnownPrincipalRef<'_>,
    field: &str,
) -> Result<Option<AccessIdentityFieldFault>, InternalError> {
    let segments: Vec<&str> = field.split('.').collect();

    match principal {
        KnownPrincipalRef::Schema(single) => {
            access_identity_schema_field(schemas, single.schema.as_str(), &segments)
        }
        KnownPrincipalRef::Variants(variants) => {
            for id in variants.variants.values() {
                let fault = access_identity_schema_field(schemas, id.as_str(), &segments)?;

                if fault.is_some() {
                    return Ok(fault);
                }
            }

            Ok(None)
        }
    }
}

/// What a reader of a principal field is told when the principal does not hold it.
pub(crate) fn access_identity_principal_field_refusal(
    reader: &str,
    field: &str,
    principal: KnownPrincipalRef<'_>,
    fault: &AccessIdentityFieldFault,
) -> AccessIdentityRefusal {
    if let AccessIdentityFieldFault::NotObject { schema, kind } = fault {
        return AccessIdentityRefusal {
            message: format!(
                "{reader} principal field '{field}', but the principal schema '{schema}' is a {kind}, not an object schema"
            ),
            fix: "Name an object schema as the principal, or as each variant, whose properties are the fields read.".to_owned(),
        };
    }

    let every_variant = if matches!(principal, KnownPrincipalRef::Variants(_)) {
        " in every variant"
    } else {
        ""
    };

    AccessIdentityRefusal {
        message: format!(
            "{reader} principal field '{field}', which its principal does not hold{every_variant}"
        ),
        fix: "Name a field of the principal schema, or add it to the schema.".to_owned(),
    }
}
