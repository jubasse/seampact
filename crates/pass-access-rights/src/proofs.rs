//! The rule proofs of a route: the header params and body fields its rules read, and the input a
//! proof-only route gets (ADR 0002 section 9, "Proofs").

use indexmap::{IndexMap, IndexSet};
use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, FieldWire, HttpMethod, Identity, IdentityId, InputMediaType,
    InputProof, IrMap, KnownIdentityRef, KnownKeysPolicyRef, KnownRequirementRef, KnownSchemaRef,
    KnownSchemeRef, KnownTypeUseRef, Origin, Param, ProofPlacement, RefTypeUse, Requirement,
    RuleProof, SchemaId, Scheme, SchemeId, SignedIdentity, TypeUse, UnknownKeys, UnknownKeysPolicy,
};
use seampact_pass_tree_nodes::tree_nodes_field_wire;
use seampact_pipeline::{DraftOperationInput, PassError, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::read::access_rights_origin_of;
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{AccessRightsRoute, access_rights_operation_of};
use crate::schema_use::AccessRightsContext;

/// What one route's proofs need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofsInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    /// The route's checked requirements, in order.
    pub(crate) requires: Vec<Requirement>,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) identities: &'draft IrMap<IdentityId, Identity>,
    pub(crate) schemes: &'draft IrMap<SchemeId, Scheme>,
}

/// The proofs of one route.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofs {
    pub(crate) headers: Vec<Param>,
    pub(crate) proofs: Vec<InputProof>,
    pub(crate) created_input: Option<DraftOperationInput>,
    pub(crate) refused_body_proofs: Vec<String>,
}

/// A header the route already takes: its name, the role that takes it and where it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RouteHeader {
    pub(crate) name: String,
    pub(crate) role: String,
    pub(crate) pointer: String,
}

/// One use of a rule's proof by a requirement.
#[derive(Debug, Clone)]
pub(crate) struct ProofUse {
    pub(crate) rule: String,
    pub(crate) proof: RuleProof,
    pub(crate) use_pointer: String,
    pub(crate) proof_pointer: String,
    pub(crate) from: Vec<Origin>,
}

const PROOF_DERIVATION: DerivationId = DerivationId::from_static("rule.proof");

const UNKNOWN_KEYS_DERIVATION: DerivationId = DerivationId::from_static("identity.unknownKeys");

const PROOF_ONLY_MEDIA: InputMediaType = InputMediaType::ApplicationJson;

const EMPTY_BODY_SCHEMA: &str = "ApiEmptyBody";

const AUTHORIZATION_HEADER: &str = "Authorization";

const SIGNED_INPUT_FIX: &str = "declare `input`";

const SIGNED_GET_FIX: &str =
    "serve the signed deliveries on a route with a body (a `post` with `input`)";

/// The media types of a body with fields (form and multipart), which carry no body proof.
const FIELD_MEDIA: &[InputMediaType] = &[
    InputMediaType::ApplicationXWwwFormUrlencoded,
    InputMediaType::MultipartFormData,
];

/// The proofs of one route: header params, body proofs and the input a proof-only route gets.
///
/// # Errors
///
/// An internal error.
pub(crate) fn access_rights_proofs(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    input: &AccessRightsProofsInput<'_>,
) -> Result<AccessRightsProofs, PassError> {
    let uses = proof_uses(context, catalogues, &input.requires)?;
    let taken_headers = route_headers(context, input)?;
    let mut headers = Vec::new();
    let mut header_uses = Vec::new();

    for header_use in shared_by_name(reporter, &input.route, &uses, &ProofPlacement::Header)? {
        if !takes_route_header(reporter, &input.route, &taken_headers, &header_use) {
            header_uses.push(header_use);
        }
    }

    for header_use in &header_uses {
        headers.push(header_param_of(header_use));
    }

    let body_uses = shared_by_name(reporter, &input.route, &uses, &ProofPlacement::Body)?;
    let declared = access_rights_operation_of(context, &input.route)?
        .input
        .as_ref();
    let identity = signed_identity_of(input)?;
    let refused_body_proofs: Vec<String> = body_uses
        .iter()
        .map(|body_use| body_use.proof.name.clone())
        .collect();

    if body_uses.is_empty() {
        if let (None, Some(identity)) = (declared, identity) {
            report_signed_without_input(context, reporter, &input.route, identity)?;
        }

        return Ok(AccessRightsProofs {
            headers,
            proofs: Vec::new(),
            created_input: None,
            refused_body_proofs: Vec::new(),
        });
    }

    let refused = AccessRightsProofs {
        headers,
        proofs: Vec::new(),
        created_input: None,
        refused_body_proofs,
    };

    let Some(declared) = declared else {
        let created = created_input(context, reporter, input, &body_uses, identity)?;

        return Ok(match created {
            None => refused,
            Some(created) => AccessRightsProofs {
                created_input: Some(created),
                refused_body_proofs: Vec::new(),
                ..refused
            },
        });
    };

    if !fits_declared_input(reporter, input, declared, &body_uses)? {
        return Ok(refused);
    }

    let field_media = FIELD_MEDIA.contains(&declared.media);
    let mut proofs = Vec::with_capacity(body_uses.len());

    for body_use in &body_uses {
        let mut proof = input_proof_of(body_use);

        if field_media {
            proof.wire = Some(proof_wire(context, body_use)?);
        }

        proofs.push(proof);
    }

    Ok(AccessRightsProofs {
        proofs,
        refused_body_proofs: Vec::new(),
        ..refused
    })
}

/// The proof of each rule the requirements use, with the origins of its use and its declaration.
///
/// # Errors
///
/// An internal error for a rule requirement with no origin.
pub(crate) fn proof_uses(
    context: &AccessRightsContext,
    catalogues: &AccessRightsCatalogues,
    requires: &[Requirement],
) -> Result<Vec<ProofUse>, PassError> {
    let mut uses = Vec::new();

    for requirement in requires {
        let KnownRequirementRef::Rule(rule) = KnownRequirementRef::try_from(requirement)? else {
            continue;
        };
        let Some(proof) = catalogues
            .rules
            .get(&rule.rule)
            .and_then(|declared| declared.proof.as_ref())
        else {
            continue;
        };

        let mut origins = requirement_origins(requirement)?;
        let proof_pointer = pointer_below("/rules", &[rule.rule.as_str(), "proof"]);
        let Some(first) = origins.first() else {
            return Err(InternalError::new(format!(
                "access.rights built a requirement on rule '{}' with no origin",
                rule.rule
            ))
            .into());
        };
        let use_pointer = first.pointer.clone();

        origins.push(access_rights_origin_of(context, &proof_pointer)?);
        uses.push(ProofUse {
            rule: rule.rule.as_str().to_owned(),
            proof: proof.clone(),
            use_pointer,
            proof_pointer,
            from: origins,
        });
    }

    Ok(uses)
}

/// The origins of a requirement: a written one has its origin, a pack-derived one the origins of
/// its derivation, the pack entry first.
///
/// # Errors
///
/// An internal error for a requirement of a kind this revision does not know.
pub(crate) fn requirement_origins(requirement: &Requirement) -> Result<Vec<Origin>, InternalError> {
    let (origin, derived_from) = match KnownRequirementRef::try_from(requirement)? {
        KnownRequirementRef::Right(right) => (&right.origin, &right.derived_from),
        KnownRequirementRef::Rule(rule) => (&rule.origin, &rule.derived_from),
    };

    if let Some(origin) = origin {
        return Ok(vec![origin.clone()]);
    }

    Ok(derived_from
        .as_ref()
        .map(|derived_from| derived_from.from.clone())
        .unwrap_or_default())
}

/// Header names are case-insensitive (RFC 9110 section 5.1).
fn header_name_key(name: &str) -> String {
    name.to_lowercase()
}

/// The key a proof name is merged under: a header name folded, a body name as written (a JSON
/// member name).
///
/// # Errors
///
/// An internal error for a placement this IR revision does not know.
pub(crate) fn name_key(placement: &ProofPlacement, name: &str) -> Result<String, InternalError> {
    match placement {
        ProofPlacement::Header => Ok(header_name_key(name)),
        ProofPlacement::Body => Ok(name.to_owned()),
        ProofPlacement::Unknown(_) => Err(InternalError::new(
            "access.rights reached a proof placement this IR revision does not know".to_owned(),
        )),
    }
}

/// The uses of one placement merged by name, in requirement order: a later use with the first
/// one's schema adds its origins to it; one with another schema is an error naming both, and adds
/// nothing.
pub(crate) fn shared_by_name(
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    uses: &[ProofUse],
    placement: &ProofPlacement,
) -> Result<Vec<ProofUse>, InternalError> {
    let mut by_name: IndexMap<String, ProofUse> = IndexMap::new();

    for use_of in uses {
        if use_of.proof.r#in != *placement {
            continue;
        }

        let key = name_key(placement, &use_of.proof.name)?;
        let Some(first) = by_name.get_mut(&key) else {
            by_name.insert(key, use_of.clone());

            continue;
        };

        // Typed IR values compare by member, as their canonical texts do.
        if first.proof.schema != use_of.proof.schema {
            report_schema_clash(reporter, route, first, use_of);

            continue;
        }

        for origin in &use_of.from {
            if !first.from.contains(origin) {
                first.from.push(origin.clone());
            }
        }
    }

    Ok(by_name.into_values().collect())
}

// The declared request headers, then the credential and CSRF headers of the route identity's
// schemes.
pub(crate) fn route_headers(
    context: &AccessRightsContext,
    input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<RouteHeader>, PassError> {
    let route = &input.route;
    let operation = access_rights_operation_of(context, route)?;
    let node = context.nodes.get(route.node)?;
    let mut headers: Vec<RouteHeader> = operation
        .params
        .iter()
        .flat_map(|params| &params.header)
        .map(|param| RouteHeader {
            name: param.name.clone(),
            role: "a declared header".to_owned(),
            pointer: param
                .origin
                .as_ref()
                .map(|origin| origin.pointer.clone())
                .or_else(|| {
                    let derived_from = param.derived_from.as_ref()?;

                    derived_from
                        .from
                        .first()
                        .map(|origin| origin.pointer.clone())
                })
                .unwrap_or_else(|| node.pointer.clone()),
        })
        .collect();

    for id in identity_scheme_ids(input)? {
        headers.extend(scheme_headers(input.schemes, &id)?);
    }

    Ok(headers)
}

pub(crate) fn identity_scheme_ids(
    input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<String>, InternalError> {
    let Some(name) = &input.route.identity else {
        return Ok(Vec::new());
    };
    let Some(identity) = input.identities.get(name) else {
        return Ok(Vec::new());
    };

    Ok(match KnownIdentityRef::try_from(identity)? {
        KnownIdentityRef::Signed(signed) => vec![signed.signed.as_str().to_owned()],
        KnownIdentityRef::Credential(credential) => {
            let schemes = &credential.schemes;
            let ids: IndexSet<&str> = schemes
                .read
                .iter()
                .chain(&schemes.write)
                .chain(&schemes.optional_read)
                .map(SchemeId::as_str)
                .collect();

            ids.into_iter().map(str::to_owned).collect()
        }
    })
}

/// The headers a scheme makes a route read. `access.identity` resolves every scheme an identity
/// names, so an unknown id is already its error.
///
/// # Errors
///
/// An internal error for a scheme of a kind this revision does not know.
pub(crate) fn scheme_headers(
    schemes: &IrMap<SchemeId, Scheme>,
    id: &str,
) -> Result<Vec<RouteHeader>, InternalError> {
    let Some(scheme) = schemes.get(id) else {
        return Ok(Vec::new());
    };
    let credential = |name: &str, origin: &Origin| {
        vec![RouteHeader {
            name: name.to_owned(),
            role: format!("the credential header of scheme '{id}'"),
            pointer: origin.pointer.clone(),
        }]
    };

    Ok(match KnownSchemeRef::try_from(scheme)? {
        KnownSchemeRef::Bearer(scheme) => credential(AUTHORIZATION_HEADER, &scheme.origin),
        KnownSchemeRef::Basic(scheme) => credential(AUTHORIZATION_HEADER, &scheme.origin),
        KnownSchemeRef::Header(scheme) => credential(&scheme.name, &scheme.origin),
        KnownSchemeRef::Signature(scheme) => scheme
            .name
            .as_ref()
            .map_or_else(Vec::new, |name| credential(name, &scheme.origin)),
        KnownSchemeRef::Cookie(scheme) => match &scheme.csrf {
            Some(csrf) => csrf_headers(schemes, csrf.as_str())?,
            None => Vec::new(),
        },
        KnownSchemeRef::Query(_) => Vec::new(),
    })
}

/// The CSRF header of a cookie scheme, when its `csrf` names a header scheme.
///
/// # Errors
///
/// An internal error for a scheme of a kind this revision does not know.
pub(crate) fn csrf_headers(
    schemes: &IrMap<SchemeId, Scheme>,
    id: &str,
) -> Result<Vec<RouteHeader>, InternalError> {
    let Some(scheme) = schemes.get(id) else {
        return Ok(Vec::new());
    };

    Ok(match KnownSchemeRef::try_from(scheme)? {
        KnownSchemeRef::Header(scheme) => vec![RouteHeader {
            name: scheme.name.clone(),
            role: format!("the CSRF header of scheme '{id}'"),
            pointer: scheme.origin.pointer.clone(),
        }],
        KnownSchemeRef::Bearer(_)
        | KnownSchemeRef::Basic(_)
        | KnownSchemeRef::Signature(_)
        | KnownSchemeRef::Cookie(_)
        | KnownSchemeRef::Query(_) => Vec::new(),
    })
}

/// Whether a header proof takes a header the route already reads; that clash is reported and the
/// proof dropped.
pub(crate) fn takes_route_header(
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    taken_headers: &[RouteHeader],
    use_of: &ProofUse,
) -> bool {
    let key = header_name_key(&use_of.proof.name);
    let Some(taken) = taken_headers
        .iter()
        .find(|header| header_name_key(&header.name) == key)
    else {
        return false;
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::ProofName,
        message: format!(
            "rule '{}' reads its header proof '{}' on route '{}', which already reads '{}', {}",
            use_of.rule, use_of.proof.name, route.id, taken.name, taken.role
        ),
        fix: "give the proof another name".to_owned(),
        pointer: use_of.use_pointer.clone(),
        distinct_by: None,
        related: vec![
            AccessRightsRelated {
                pointer: use_of.proof_pointer.clone(),
                message: "the proof is declared here".to_owned(),
            },
            AccessRightsRelated {
                pointer: taken.pointer.clone(),
                message: "the header is declared here".to_owned(),
            },
        ],
    });

    true
}

pub(crate) fn report_schema_clash(
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    first: &ProofUse,
    later: &ProofUse,
) {
    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::ProofName,
        message: format!(
            "rules '{}' and '{}' read the {} proof '{}' on route '{}' with different schemas",
            first.rule, later.rule, later.proof.r#in, later.proof.name, route.id
        ),
        fix: "give one of the proofs another name, or the same schema".to_owned(),
        pointer: later.use_pointer.clone(),
        distinct_by: None,
        related: vec![
            AccessRightsRelated {
                pointer: later.proof_pointer.clone(),
                message: "this proof is declared here".to_owned(),
            },
            AccessRightsRelated {
                pointer: first.use_pointer.clone(),
                message: "the first requirement reading that name".to_owned(),
            },
            AccessRightsRelated {
                pointer: first.proof_pointer.clone(),
                message: "whose proof is declared here".to_owned(),
            },
        ],
    });
}

pub(crate) fn derived_from_of(use_of: &ProofUse) -> DerivedFrom {
    DerivedFrom {
        derivation: PROOF_DERIVATION,
        from: use_of.from.clone(),
    }
}

pub(crate) fn header_param_of(use_of: &ProofUse) -> Param {
    Param {
        name: use_of.proof.name.clone(),
        r#type: use_of.proof.schema.clone(),
        required: true,
        wire: None,
        default: None,
        origin: None,
        derived_from: Some(derived_from_of(use_of)),
    }
}

pub(crate) fn input_proof_of(use_of: &ProofUse) -> InputProof {
    InputProof {
        name: use_of.proof.name.clone(),
        schema: use_of.proof.schema.clone(),
        wire: None,
        derived_from: derived_from_of(use_of),
    }
}

/// A form or multipart proof is sent as a field of its type use is; `tree.schemas` answers the
/// proof's schema position, as it does a form field's.
pub(crate) fn proof_wire(
    context: &AccessRightsContext,
    use_of: &ProofUse,
) -> Result<FieldWire, PassError> {
    tree_nodes_field_wire(
        &pointer_below(&use_of.proof_pointer, &["schema"]),
        &use_of.proof.schema,
        context.schemas,
    )
}

pub(crate) fn signed_identity_of<'draft>(
    input: &AccessRightsProofsInput<'draft>,
) -> Result<Option<&'draft SignedIdentity>, InternalError> {
    let Some(name) = &input.route.identity else {
        return Ok(None);
    };
    let Some(identity) = input.identities.get(name) else {
        return Ok(None);
    };

    Ok(match KnownIdentityRef::try_from(identity)? {
        KnownIdentityRef::Signed(signed) => Some(signed),
        KnownIdentityRef::Credential(_) => None,
    })
}

pub(crate) fn report_signed_without_input(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    identity: &SignedIdentity,
) -> Result<(), InternalError> {
    let operation = access_rights_operation_of(context, route)?;
    let fix = if operation.method == Some(HttpMethod::Get) {
        SIGNED_GET_FIX
    } else {
        SIGNED_INPUT_FIX
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::SignedInput,
        message: format!(
            "route '{}' runs under signed identity '{}', whose signature covers the raw body, and has no input",
            route.id, identity.id
        ),
        fix: fix.to_owned(),
        pointer: context.nodes.get(route.node)?.pointer.clone(),
        distinct_by: None,
        related: Vec::new(),
    });

    Ok(())
}

/// The input a route with no `input` gets for its body proofs; a body proof needs a body: a `get`
/// has none, nor a `delete` that declares no input.
pub(crate) fn created_input(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsProofsInput<'_>,
    uses: &[ProofUse],
    identity: Option<&SignedIdentity>,
) -> Result<Option<DraftOperationInput>, PassError> {
    let route = &input.route;
    let method = access_rights_operation_of(context, route)?.method.as_ref();
    let Some(first) = uses.first() else {
        return Err(InternalError::new(
            "a proof-only input is created for a body proof".to_owned(),
        )
        .into());
    };

    if let Some(method @ (HttpMethod::Get | HttpMethod::Delete)) = method {
        for use_of in uses {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::ProofInput,
                message: format!(
                    "rule '{}' reads its proof '{}' from the body of route '{}', a {method} without input",
                    use_of.rule, use_of.proof.name, route.id
                ),
                fix: if *method == HttpMethod::Get {
                    "read the proof in a header, or require the rule on a route with a body"
                } else {
                    "declare the route's `input`, read the proof in a header, or require the rule elsewhere"
                }
                .to_owned(),
                pointer: use_of.use_pointer.clone(),
                distinct_by: None,
                related: vec![AccessRightsRelated {
                    pointer: use_of.proof_pointer.clone(),
                    message: "the proof is declared here".to_owned(),
                }],
            });
        }

        return Ok(None);
    }

    let Some(origin) = first.from.first() else {
        return Err(InternalError::new(
            "a proof use lists its requirement's origin first".to_owned(),
        )
        .into());
    };
    let unknown_keys = match identity {
        Some(identity) => identity_unknown_keys(identity)?,
        None => None,
    };

    Ok(Some(DraftOperationInput {
        media: PROOF_ONLY_MEDIA,
        schema: TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new(EMPTY_BODY_SCHEMA.to_owned()),
            unknown_keys,
            nullable: None,
            docs: None,
            examples: None,
        }),
        body_limit_bytes: None,
        raw_body: Some(identity.is_some()),
        fields: None,
        proofs: Some(uses.iter().map(input_proof_of).collect()),
        origin: origin.clone(),
    }))
}

/// The identity's policy, copied with its derivation as `access.identity` writes it on a declared
/// input, so every `ref` input of a signed route carries it.
pub(crate) fn identity_unknown_keys(
    identity: &SignedIdentity,
) -> Result<Option<UnknownKeys>, InternalError> {
    let Some(policy) = &identity.unknown_keys else {
        return Ok(None);
    };
    let (policy, reason) = match KnownKeysPolicyRef::try_from(policy)? {
        KnownKeysPolicyRef::Ignore(ignore) => (UnknownKeysPolicy::Ignore, ignore.reason.clone()),
        KnownKeysPolicyRef::Keep(keep) => (UnknownKeysPolicy::Keep, keep.reason.clone()),
    };

    Ok(Some(UnknownKeys {
        policy,
        reason: Some(reason),
        origin: None,
        derived_from: Some(DerivedFrom {
            derivation: UNKNOWN_KEYS_DERIVATION,
            from: vec![identity.origin.clone()],
        }),
    }))
}

// A declared input that is no named object schema: `unbuilt` is the reference whose schema is
// not among the compiled ones.
fn report_unfit_input(
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    declared: &DraftOperationInput,
    first: &ProofUse,
    unbuilt: Option<&RefTypeUse>,
) {
    let (message, fix) = match unbuilt {
        Some(reference) => (
            format!(
                "rule '{}' reads its proof '{}' from the body of route '{}', whose input schema '{}' is not among the compiled schemas",
                first.rule, first.proof.name, route.id, reference.schema
            ),
            "declare the input schema under `schemas`, or read the proof in a header",
        ),
        None => (
            format!(
                "rule '{}' reads its proof '{}' from the body of route '{}', whose input is no named object schema",
                first.rule, first.proof.name, route.id
            ),
            "make the route's input an object schema, or read the proof in a header",
        ),
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::ProofInput,
        message,
        fix: fix.to_owned(),
        pointer: first.use_pointer.clone(),
        distinct_by: None,
        related: vec![AccessRightsRelated {
            pointer: declared.origin.pointer.clone(),
            message: "the route's input is declared here".to_owned(),
        }],
    });
}

/// Whether body proofs fit a declared input: a `ref` use of an object schema whose properties and
/// form fields bear none of the proofs' names. Each misfit is reported.
pub(crate) fn fits_declared_input(
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsProofsInput<'_>,
    declared: &DraftOperationInput,
    uses: &[ProofUse],
) -> Result<bool, PassError> {
    let route = &input.route;
    let reference = match KnownTypeUseRef::try_from(&declared.schema)? {
        KnownTypeUseRef::Ref(reference) => Some(reference),
        KnownTypeUseRef::Array(_)
        | KnownTypeUseRef::Scalar(_)
        | KnownTypeUseRef::Enum(_)
        | KnownTypeUseRef::File(_)
        | KnownTypeUseRef::Opaque(_) => None,
    };
    let schema = match reference {
        Some(reference) => input.schemas.get(reference.schema.as_str()),
        None => None,
    };
    let object = match schema {
        Some(schema) => match KnownSchemaRef::try_from(schema)? {
            KnownSchemaRef::Object(object) => Some(object),
            KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => None,
        },
        None => None,
    };

    let Some(object) = object else {
        let Some(first) = uses.first() else {
            return Err(InternalError::new(
                "a declared input is checked for a body proof".to_owned(),
            )
            .into());
        };
        let unbuilt = match (reference, schema) {
            (Some(reference), None) => Some(reference),
            _ => None,
        };

        report_unfit_input(reporter, route, declared, first, unbuilt);

        return Ok(false);
    };

    let mut fits = true;

    for use_of in uses {
        let name = &use_of.proof.name;
        let property = object
            .properties
            .iter()
            .find(|candidate| candidate.name == *name);
        let field = declared
            .fields
            .iter()
            .flatten()
            .find(|candidate| candidate.name == *name);

        if property.is_none() && field.is_none() {
            continue;
        }

        fits = false;
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ProofName,
            message: format!(
                "rule '{}' reads its proof '{name}' from the body of route '{}', whose input already has a field '{name}'",
                use_of.rule, route.id
            ),
            fix: "rename the input's field, or give the proof another name".to_owned(),
            pointer: use_of.use_pointer.clone(),
            distinct_by: None,
            related: vec![
                AccessRightsRelated {
                    pointer: use_of.proof_pointer.clone(),
                    message: "the proof is declared here".to_owned(),
                },
                AccessRightsRelated {
                    pointer: property
                        .map_or(&declared.origin, |found| &found.origin)
                        .pointer
                        .clone(),
                    message: "the input's field is declared here".to_owned(),
                },
            ],
        });
    }

    Ok(fits)
}

#[cfg(test)]
mod name_tests {
    use super::*;

    #[test]
    fn a_header_name_folds_case_and_a_body_name_does_not() {
        let key = |placement: &ProofPlacement, name: &str| name_key(placement, name).unwrap();

        assert_eq!(key(&ProofPlacement::Header, "X-Token"), "x-token");
        assert_eq!(key(&ProofPlacement::Body, "X-Token"), "X-Token");
        // JavaScript's toLowerCase maps U+0130 to "i" and a combining dot, as Rust does.
        assert_eq!(key(&ProofPlacement::Header, "\u{130}"), "i\u{307}");
        assert_eq!(key(&ProofPlacement::Header, "\u{3a3}"), "\u{3c3}");
        assert_eq!(key(&ProofPlacement::Header, "A\u{3a3}"), "a\u{3c2}");
    }
}
