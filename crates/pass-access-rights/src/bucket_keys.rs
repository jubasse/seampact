//! The key sources of each bucket a route counts in, checked at that use (ADR 0002 section 9,
//! "Buckets").

use seampact_diagnostics::InternalError;
use seampact_ir::IrMap;
use seampact_ir::{
    InputProof, KnownRequirementRef, KnownSchemaRef, KnownTypeUseRef, Property, Requirement,
    Schema, SchemaId, ValueSource, ValueSourceIn,
};
use seampact_pipeline::{DraftOperationInput, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::routes::{AccessRightsAccessKind, AccessRightsRoute};
use crate::source::access_rights_source_text;

/// What one route's bucket uses need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsBucketKeysInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    pub(crate) requires: Vec<Requirement>,
    /// The route's input as it ends: declared, created for its proofs, or none.
    pub(crate) input: Option<&'draft DraftOperationInput>,
    pub(crate) proofs: Vec<InputProof>,
    /// The names of the route's body proofs refused while building them.
    pub(crate) refused_proofs: Vec<String>,
    pub(crate) schemas: &'draft IrMap<SchemaId, Schema>,
}

/// Why a key cannot be filled, and what to do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyProblem {
    pub(crate) why: String,
    pub(crate) fix: String,
}

const COUNTABLE_TYPES: &[&str] = &["string", "integer"];

/// Reports each key of a bucket the route counts in that the route cannot fill.
///
/// # Errors
///
/// An internal error for a bucket requirement it cannot place, and what its callees fail with.
pub(crate) fn access_rights_check_bucket_keys(
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    input: &AccessRightsBucketKeysInput<'_>,
) -> Result<(), InternalError> {
    for requirement in &input.requires {
        let KnownRequirementRef::Rule(rule) = KnownRequirementRef::try_from(requirement)? else {
            continue;
        };
        let Some(bucket_id) = &rule.bucket else {
            continue;
        };

        let bucket = catalogues.buckets.get(bucket_id);
        let use_pointer = rule
            .origin
            .as_ref()
            .map(|origin| origin.pointer.as_str())
            .or_else(|| {
                let derived_from = rule.derived_from.as_ref()?;

                derived_from
                    .from
                    .first()
                    .map(|origin| origin.pointer.as_str())
            });
        let (Some(bucket), Some(use_pointer)) = (bucket, use_pointer) else {
            return Err(InternalError::new(format!(
                "access.rights built a requirement counting in bucket '{bucket_id}' it cannot place"
            )));
        };

        for (index, source) in bucket.key.iter().enumerate() {
            let Some(problem) = key_problem(input, source)? else {
                continue;
            };
            let source_text = access_rights_source_text(source);

            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::BucketKey,
                message: format!(
                    "bucket '{}' counts {source_text} on route '{}', {}",
                    bucket.id, input.route.id, problem.why
                ),
                fix: problem.fix,
                pointer: use_pointer.to_owned(),
                distinct_by: Some(source_text),
                related: vec![AccessRightsRelated {
                    pointer: pointer_below(
                        "/buckets",
                        &[bucket.id.as_str(), "key", &index.to_string()],
                    ),
                    message: "the key is declared here".to_owned(),
                }],
            });
        }
    }

    Ok(())
}

pub(crate) fn key_problem(
    input: &AccessRightsBucketKeysInput<'_>,
    source: &ValueSource,
) -> Result<Option<KeyProblem>, InternalError> {
    if source.r#in == ValueSourceIn::Principal
        && input.route.access != AccessRightsAccessKind::Identity
    {
        let route_kind = if input.route.access == AccessRightsAccessKind::Public {
            "a public"
        } else {
            "an optional-auth"
        };

        return Ok(Some(KeyProblem {
            why: format!("{route_kind} route, where the principal may be null"),
            fix: "count the bucket by a source every caller has (address, a body field), or require it on an identified route".to_owned(),
        }));
    }

    let (ValueSourceIn::Body, Some(name)) = (&source.r#in, &source.name) else {
        return Ok(None);
    };

    body_key_problem(input, name)
}

pub(crate) fn body_key_problem(
    input: &AccessRightsBucketKeysInput<'_>,
    name: &str,
) -> Result<Option<KeyProblem>, InternalError> {
    let Some(property) = input_property(input, name)? else {
        return Ok(proof_key_problem(input, name));
    };

    if property.sensitive {
        return Ok(Some(KeyProblem {
            why: format!("whose input field '{name}' is sensitive"),
            fix: "count a field that is not sensitive, or another source".to_owned(),
        }));
    }

    if property.optional || property.nullable {
        return Ok(Some(KeyProblem {
            why: format!("whose input field '{name}' may be absent or null"),
            fix: "make the field required and non-null, or count another source".to_owned(),
        }));
    }

    if let KnownTypeUseRef::Scalar(scalar) = KnownTypeUseRef::try_from(&property.r#type)?
        && COUNTABLE_TYPES.contains(&scalar.r#type.as_str())
    {
        return Ok(None);
    }

    Ok(Some(KeyProblem {
        why: format!("whose input field '{name}' is no string or integer"),
        fix: "count a string or integer field of the input".to_owned(),
    }))
}

// A body key that is no input field: a body proof, sensitive by definition, or nothing the body
// carries.
pub(crate) fn proof_key_problem(
    input: &AccessRightsBucketKeysInput<'_>,
    name: &str,
) -> Option<KeyProblem> {
    if input.refused_proofs.iter().any(|refused| refused == name) {
        return None;
    }

    if input.proofs.iter().any(|proof| proof.name == name) {
        return Some(KeyProblem {
            why: format!("whose body field '{name}' is a rule proof, which is sensitive"),
            fix: "count an input field that is not sensitive, or another source".to_owned(),
        });
    }

    Some(KeyProblem {
        why: format!("whose input has no field '{name}'"),
        fix:
            "count a field the input declares, or require the bucket on a route whose input has it"
                .to_owned(),
    })
}

// A property of the route's object input schema.
pub(crate) fn input_property<'draft>(
    input: &AccessRightsBucketKeysInput<'draft>,
    name: &str,
) -> Result<Option<&'draft Property>, InternalError> {
    let Some(declared) = input.input else {
        return Ok(None);
    };
    let KnownTypeUseRef::Ref(reference) = KnownTypeUseRef::try_from(&declared.schema)? else {
        return Ok(None);
    };
    let schemas: &'draft IrMap<SchemaId, Schema> = input.schemas;
    let Some(schema) = schemas.get(reference.schema.as_str()) else {
        return Ok(None);
    };

    Ok(match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => object
            .properties
            .iter()
            .find(|candidate| candidate.name == name),
        KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => None,
    })
}
