//! Principal requirements and bindings of an operation (ADR 0002 section 9): the union of
//! `principal.requires`, each field held by the principal (every variant of a variants
//! principal), and the `bindings` from the root down, each source present on the route and each
//! target a principal field. One key bound to two different values is an error naming both
//! origins (ADR 0002 section 8); a key bound again to the same value keeps the first.

use std::cmp::Ordering;
use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{Binding, PrincipalRequirement, ValueSource};
use seampact_json::JsonValue;
use seampact_pipeline::{
    InheritedEntry, OrderedSetting, PassError, TreeNodes, UnionSetting, pointer_below,
};

use crate::access::{AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope};
use crate::not_ported::not_ported_yet;
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
    scope: &mut AccessIdentityScope<'_, '_, '_>,
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
    scope: &mut AccessIdentityScope<'_, '_, '_>,
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

    sort_by_source(&mut bindings)?;

    Ok(bindings)
}

// `Array.prototype.sort` with `bySource`: a failing comparator stops the sort with its error.
fn sort_by_source(bindings: &mut [Binding]) -> Result<(), PassError> {
    let mut failure = None;

    bindings.sort_by(|left, right| match by_source(left, right) {
        Ok(order) => order,
        Err(error) => {
            failure.get_or_insert(error);

            Ordering::Equal
        }
    });

    failure.map_or(Ok(()), Err)
}

fn source_text(_source: &ValueSource) -> Result<String, PassError> {
    Err(not_ported_yet("sourceText"))
}

fn by_source(_left: &Binding, _right: &Binding) -> Result<Ordering, PassError> {
    Err(not_ported_yet("bySource"))
}

// The pointer of a written requirement: the first item naming the field on the node that set it.
fn requirement_pointer(
    _entry: &InheritedEntry<'_>,
    _field: &str,
    _nodes: &TreeNodes<'_>,
) -> Result<String, PassError> {
    Err(not_ported_yet("requirementPointer"))
}

// The messages name the identity, never the route, so a setting reaching many routes is reported
// once.
fn principal_holds(
    _route: &AccessIdentityRoute<'_, '_>,
    _resolved: &AccessIdentityResolved<'_>,
    _field: &str,
    _pointer: &str,
    _reader: &Reader,
    _scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("principalHolds"))
}

fn report_conflict(
    _key: &str,
    _pointer: &str,
    _first: &InheritedEntry<'_>,
    _scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportConflict"))
}

// A binding's source on the route: a path placeholder, a declared query field, or a field of the
// body input.
fn binding_source_found(
    _route: &AccessIdentityRoute<'_, '_>,
    _key: &str,
    _source: &ValueSource,
    _pointer: &str,
    _scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("bindingSourceFound"))
}

fn body_has_field(
    _route: &AccessIdentityRoute<'_, '_>,
    _field: &str,
    _scope: &AccessIdentityScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("bodyHasField"))
}
