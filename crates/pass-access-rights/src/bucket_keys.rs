//! The key sources of each bucket a route counts in, checked at that use (ADR 0002 section 9,
//! "Buckets").

use seampact_diagnostics::InternalError;
use seampact_ir::IrMap;
use seampact_ir::{
    InputProof, KnownRequirementRef, Property, Requirement, Schema, SchemaId, ValueSource,
    ValueSourceIn,
};
use seampact_pipeline::{DraftOperationInput, PassError, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
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
) -> Result<(), PassError> {
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
            ))
            .into());
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
) -> Result<Option<KeyProblem>, PassError> {
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
    _input: &AccessRightsBucketKeysInput<'_>,
    _name: &str,
) -> Result<Option<KeyProblem>, PassError> {
    Err(not_ported_yet("bodyKeyProblem"))
}

pub(crate) fn proof_key_problem(
    _input: &AccessRightsBucketKeysInput<'_>,
    _name: &str,
) -> Result<Option<KeyProblem>, PassError> {
    Err(not_ported_yet("proofKeyProblem"))
}

pub(crate) fn input_property<'draft>(
    _input: &AccessRightsBucketKeysInput<'draft>,
    _name: &str,
) -> Result<Option<&'draft Property>, PassError> {
    Err(not_ported_yet("inputProperty"))
}
