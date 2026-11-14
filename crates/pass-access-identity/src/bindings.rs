//! Principal requirements and bindings of an operation (ADR 0002 section 9): the union of
//! `principal.requires`, each field held by the principal (every variant of a variants
//! principal), and the `bindings` from the root down, each source present on the route and each
//! target a principal field. One key bound to two different values is an error naming both
//! origins (ADR 0002 section 8); a key bound again to the same value keeps the first.

use std::cmp::Ordering;
use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Binding, KnownPrincipalRef, PrincipalRequirement, TypeUse, ValueSource, ValueSourceIn,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{
    InheritedEntry, OrderedSetting, PassError, TreeNodes, UnionSetting, pointer_below,
};

use crate::access::{
    AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope, access_identity_id,
    access_identity_principal_of,
};
use crate::params::{AccessIdentityParameterLocation, access_identity_route_has_parameter};
use crate::principal::{
    access_identity_principal_field, access_identity_principal_field_refusal,
    access_identity_schema_field,
};
use crate::read::{access_identity_object, access_identity_strings};
use crate::report::{AccessIdentityProblem, AccessIdentityRelated, AccessIdentityRule};
use crate::source::access_identity_value_source;

/// Who reads a principal field, for the messages: `'principal.requires' names`,
/// `binding '<key>' reads`.
pub(crate) struct Reader {
    pub(crate) subject: String,
    pub(crate) verb: ReaderVerb,
}

/// The verb of a [`Reader`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderVerb {
    Names,
    Reads,
}

impl ReaderVerb {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Names => "names",
            Self::Reads => "reads",
        }
    }
}

/// The fields the principal must hold on the route; a field it does not hold is reported and
/// left out.
pub(crate) fn access_identity_principal_requires(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Vec<PrincipalRequirement>, PassError> {
    let inherited = scope.reporter.inherited();
    let entries = inherited
        .union(route.node_id, UnionSetting::PrincipalRequires)?
        .unwrap_or(Vec::new());
    let mut requirements = Vec::new();

    for entry in &entries {
        let node = inherited.nodes().get(entry.node)?;

        // The authoring schema writes each requirement as a field name.
        let JsonValue::String(field) = entry.value else {
            return Err(InternalError::new(format!(
                "a principal requirement set at {} is not a field name",
                node.pointer
            ))
            .into());
        };
        let pointer = requirement_pointer(entry, field, inherited.nodes())?;
        let reader = Reader {
            subject: "'principal.requires'".to_owned(),
            verb: ReaderVerb::Names,
        };

        if principal_holds(route, resolved, field, &pointer, &reader, scope)? {
            requirements.push(PrincipalRequirement {
                field: field.clone(),
                origin: entry.origin.clone(),
            });
        }
    }

    Ok(requirements)
}

/// The bindings of the route, sorted by source; a binding with an error is reported and left out.
pub(crate) fn access_identity_bindings(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Vec<Binding>, PassError> {
    let inherited = scope.reporter.inherited();
    let entries = inherited
        .ordered(route.node_id, OrderedSetting::Bindings)?
        .unwrap_or(Vec::new());
    let mut first_by_key: HashMap<&str, &InheritedEntry<'_>> = HashMap::new();
    let mut bindings = Vec::new();

    for entry in &entries {
        let node = inherited.nodes().get(entry.node)?;

        // The authoring schema keys a binding by its source and writes its target as a principal
        // source.
        let (Some(key), JsonValue::String(target)) = (entry.key.as_deref(), entry.value) else {
            return Err(InternalError::new(format!(
                "a binding set at {} has no source key or no target",
                node.pointer
            ))
            .into());
        };
        let pointer = pointer_below(&node.pointer, &["bindings", key]);

        if let Some(first) = first_by_key.get(key) {
            if first.value != entry.value {
                report_conflict(key, &pointer, first, scope)?;
            }

            continue;
        }

        first_by_key.insert(key, entry);

        let from = access_identity_value_source(key)?;
        let to = access_identity_value_source(target)?;
        let reader = Reader {
            subject: format!("binding '{key}'"),
            verb: ReaderVerb::Reads,
        };
        let source_found = binding_source_found(route, key, &from, &pointer, scope)?;
        let target_name = to.name.as_deref().unwrap_or("");
        let target_held = principal_holds(route, resolved, target_name, &pointer, &reader, scope)?;

        if source_found && target_held {
            bindings.push(Binding {
                from,
                to,
                origin: entry.origin.clone(),
            });
        }
    }

    bindings.sort_by(by_source);

    Ok(bindings)
}

// A source as text: `path.workspaceId`, or the location alone when it has no name.
fn source_text(source: &ValueSource) -> String {
    match &source.name {
        Some(name) => format!("{}.{name}", source.r#in),
        None => source.r#in.to_string(),
    }
}

// Strings compare by UTF-16 code unit, as `<` does.
fn by_source(left: &Binding, right: &Binding) -> Ordering {
    cmp_utf16(&source_text(&left.from), &source_text(&right.from))
}

// The pointer of a written requirement: the first item naming the field on the node that set it.
fn requirement_pointer(
    entry: &InheritedEntry<'_>,
    field: &str,
    nodes: &TreeNodes<'_>,
) -> Result<String, InternalError> {
    let node = nodes.get(entry.node)?;
    let requires = access_identity_object(node.settings, "principal")
        .and_then(|principal| access_identity_strings(principal, "requires"))
        .unwrap_or_default();
    let index = requires.iter().position(|candidate| candidate == field);

    let Some(index) = index else {
        return Err(InternalError::new(format!(
            "the principal requirement '{field}' is not written at {}",
            node.pointer
        )));
    };

    Ok(pointer_below(
        &node.pointer,
        &["principal", "requires", &index.to_string()],
    ))
}

// The messages name the identity, never the route, so a setting reaching many routes is reported
// once.
fn principal_holds(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    field: &str,
    pointer: &str,
    reader: &Reader,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<bool, InternalError> {
    let Some(identity) = resolved.identity else {
        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::PrincipalField,
            message: format!(
                "{} {} principal field '{field}' on a public route, which has no principal",
                reader.subject,
                reader.verb.as_str()
            ),
            fix: "Remove it from the public route, or give the route an identity.".to_owned(),
            pointer: pointer.to_owned(),
            related: vec![AccessIdentityRelated {
                pointer: route.node.pointer.clone(),
                message: "a public route it reaches".to_owned(),
            }],
        })?;

        return Ok(false);
    };

    let principal = KnownPrincipalRef::try_from(access_identity_principal_of(identity))?;
    let fault = access_identity_principal_field(scope.schemas, principal, field)?;

    let Some(fault) = fault else {
        return Ok(true);
    };

    let subject = format!(
        "{} under identity '{}' {}",
        reader.subject,
        access_identity_id(identity),
        reader.verb.as_str()
    );
    let refusal = access_identity_principal_field_refusal(&subject, field, principal, &fault);

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::PrincipalField,
        message: refusal.message,
        fix: refusal.fix,
        pointer: pointer.to_owned(),
        related: Vec::new(),
    })?;

    Ok(false)
}

fn report_conflict(
    key: &str,
    pointer: &str,
    first: &InheritedEntry<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<(), InternalError> {
    let first_node = scope.reporter.inherited().nodes().get(first.node)?;

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::BindingConflict,
        message: format!(
            "'{key}' is bound to {} above and to another principal field here",
            stringify_json(first.value)
        ),
        fix: "Bind each request value to one principal field: remove one of the two bindings."
            .to_owned(),
        pointer: pointer.to_owned(),
        related: vec![AccessIdentityRelated {
            pointer: pointer_below(&first_node.pointer, &["bindings", key]),
            message: "the first binding".to_owned(),
        }],
    })
}

// A binding's source on the route: a path placeholder, a declared query field, or a field of the
// body input.
fn binding_source_found(
    route: &AccessIdentityRoute<'_, '_>,
    key: &str,
    source: &ValueSource,
    pointer: &str,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<bool, InternalError> {
    let name = source.name.as_deref().unwrap_or("");
    let found = match source.r#in {
        ValueSourceIn::Path => access_identity_route_has_parameter(
            route.operation,
            AccessIdentityParameterLocation::Path,
            name,
        ),
        ValueSourceIn::Query => access_identity_route_has_parameter(
            route.operation,
            AccessIdentityParameterLocation::Query,
            name,
        ),
        _ => body_has_field(route, name, scope)?,
    };

    if found {
        return Ok(true);
    }

    let location = match source.r#in {
        ValueSourceIn::Body => format!("no input body field '{name}'"),
        ValueSourceIn::Path => format!("no path placeholder '{name}'"),
        _ => format!("no declared query field '{name}'"),
    };

    scope.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::BindingSource,
        message: format!(
            "binding '{key}' reads a value route '{}' does not carry: it has {location}",
            route.id
        ),
        fix: "Bind a value the route declares (a path placeholder, a query field or a field of its object input), or move the binding to the routes that carry it.".to_owned(),
        pointer: pointer.to_owned(),
        related: Vec::new(),
    })?;

    Ok(false)
}

fn body_has_field(
    route: &AccessIdentityRoute<'_, '_>,
    field: &str,
    scope: &AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<bool, InternalError> {
    let Some(TypeUse::Ref(schema)) = route.operation.input.as_ref().map(|input| &input.schema)
    else {
        return Ok(false);
    };
    let segments: Vec<&str> = field.split('.').collect();
    let fault = access_identity_schema_field(scope.schemas, schema.schema.as_str(), &segments)?;

    Ok(fault.is_none())
}
