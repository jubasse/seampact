//! The requirements of a route: written and pack-derived, each target, params, subject and
//! bucket checked (ADR 0002 section 9).

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    DerivationId, DerivedFrom, KnownRequirementRef, OperationScope, Origin, Requirement, Rule,
};
use seampact_json::JsonValue;
use seampact_pipeline::{OrderedSetting, PassError, TreeNodeId, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::packs::{
    AccessRightsDeriveEntry, AccessRightsTemplate, access_rights_expand, access_rights_selects,
};
use crate::params::AccessRightsCheckedParams;
use crate::read::{
    access_rights_member, access_rights_object, access_rights_origin_of, access_rights_string,
};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{AccessRightsApi, AccessRightsRoute};
use crate::schema_use::AccessRightsContext;

/// What a requirement item names: a right or a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequirementKind {
    Right,
    Rule,
}

/// The kind and name a requirement item targets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RequirementTarget {
    pub(crate) kind: RequirementKind,
    pub(crate) target: String,
}

/// One requirement item, written or derived, before its checks.
#[derive(Debug, Clone)]
pub(crate) struct RequirementUse<'run> {
    pub(crate) kind: RequirementKind,
    pub(crate) target: String,
    pub(crate) item: &'run JsonValue,
    pub(crate) item_pointer: String,
    pub(crate) use_pointer: String,
    pub(crate) entry: Option<String>,
    pub(crate) origin: Option<Origin>,
    pub(crate) derived_from: Option<DerivedFrom>,
}

/// What one route's requirements need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRequiresInput<'run, 'draft> {
    pub(crate) route: &'draft AccessRightsRoute,
    pub(crate) scopes: &'draft [OperationScope],
    pub(crate) api: &'draft AccessRightsApi,
    pub(crate) entries: &'draft [AccessRightsDeriveEntry<'run>],
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
}

/// Requirement items checked once each, whatever the number of routes they apply to: the target,
/// its params and its bucket. A failed item is remembered as `None`, so its uses add no error.
#[derive(Debug, Clone, Default)]
pub(crate) struct AccessRightsItemChecks {
    pub(crate) checked: HashMap<String, Option<AccessRightsCheckedParams>>,
}

/// A requirement built from a use, with the key that finds its repeats.
#[derive(Debug, Clone)]
pub(crate) struct BuiltRequirement<'run> {
    pub(crate) use_of: RequirementUse<'run>,
    pub(crate) requirement: Requirement,
    pub(crate) key: String,
}

/// Fresh item checks.
pub(crate) fn access_rights_item_checks() -> AccessRightsItemChecks {
    AccessRightsItemChecks {
        checked: HashMap::new(),
    }
}

/// The ordered requirements of a route, each checked; the route's other requirement errors are
/// reported.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a check or a builder.
pub(crate) fn access_rights_requirements<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsItemChecks,
    input: &AccessRightsRequiresInput<'run, '_>,
) -> Result<Vec<Requirement>, PassError> {
    // A route with a failed requirement may have dropped its caller right, so it is not checked
    // for one.
    let errors_before_uses = reporter.errors();
    let mut uses = derived_uses(context, reporter, input)?;

    uses.extend(written_uses(context, reporter, input)?);

    let mut route_failed = reporter.errors() != errors_before_uses;
    let mut built = Vec::new();

    for use_of in uses {
        let checked = check_item(context, reporter, catalogues, checks, &use_of)?;
        let requirement = match &checked {
            None => None,
            Some(checked) => requirement_of(
                context,
                reporter,
                catalogues,
                input,
                &use_of,
                checked.params.as_ref(),
            )?,
        };
        let Some(requirement) = requirement else {
            route_failed = true;

            continue;
        };

        built.push(BuiltRequirement {
            key: equality_key(&requirement)?,
            use_of,
            requirement,
        });
    }

    let requirements = without_repeats(reporter, &built)?;

    if !route_failed {
        check_caller_right(reporter, catalogues, input, &requirements)?;
    }

    Ok(requirements)
}

/// Checks every entry of the `requirements` catalogue once, used or not: its target, params and
/// bucket. A use of an entry then finds it checked.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a check.
pub(crate) fn access_rights_check_requirement_entries(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsItemChecks,
) -> Result<(), PassError> {
    let raw = context.context.raw;
    let Some(entries) =
        access_rights_object(access_rights_member(Some(&raw.merged), "requirements"))
    else {
        return Ok(());
    };

    for (name, item) in entries {
        if access_rights_object(Some(item)).is_none() {
            continue;
        }

        let item_pointer = pointer_below("/requirements", &[name]);
        let target = target_of(item, &item_pointer)?;

        check_item(
            context,
            reporter,
            catalogues,
            checks,
            &RequirementUse {
                kind: target.kind,
                target: target.target,
                item,
                use_pointer: item_pointer.clone(),
                item_pointer,
                entry: Some(name.clone()),
                origin: None,
                derived_from: None,
            },
        )?;
    }

    Ok(())
}

pub(crate) fn derived_uses<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsRequiresInput<'run, '_>,
) -> Result<Vec<RequirementUse<'run>>, PassError> {
    let mut uses = Vec::new();

    for entry in input.entries {
        let Some(require) = access_rights_member(Some(entry.settings), "require") else {
            continue;
        };

        if !access_rights_selects(context, entry, input.route, input.api)? {
            continue;
        }

        let pointer = pointer_below(&entry.pointer, &["require"]);
        let derived_from = DerivedFrom {
            derivation: DerivationId::new(entry.derivation.clone()),
            from: vec![access_rights_origin_of(context, &pointer)?],
        };
        let Some((kind, target)) = derived_target(reporter, require, &pointer, input.route)? else {
            continue;
        };

        uses.push(RequirementUse {
            kind,
            target,
            item: require,
            item_pointer: pointer.clone(),
            use_pointer: pointer,
            entry: None,
            origin: None,
            derived_from: Some(derived_from),
        });
    }

    Ok(uses)
}

// A pack's `require` names a rule, or a right template expanded for the route; `None` after an
// error.
fn derived_target(
    reporter: &mut AccessRightsReporter,
    require: &JsonValue,
    pointer: &str,
    route: &AccessRightsRoute,
) -> Result<Option<(RequirementKind, String)>, PassError> {
    let require = access_rights_object(Some(require));

    if let Some(rule) = access_rights_string(require, "rule") {
        return Ok(Some((RequirementKind::Rule, rule.to_owned())));
    }

    let Some(template) = access_rights_string(require, "right") else {
        return Err(InternalError::new(format!(
            "the pack require at {pointer} names neither a right nor a rule"
        ))
        .into());
    };
    let expanded = access_rights_expand(
        reporter,
        &AccessRightsTemplate {
            text: template.to_owned(),
            pointer: pointer_below(pointer, &["right"]),
        },
        route,
    )?;

    Ok(expanded.map(|right| (RequirementKind::Right, right)))
}

pub(crate) fn written_uses<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsRequiresInput<'run, '_>,
) -> Result<Vec<RequirementUse<'run>>, PassError> {
    let raw = context.context.raw;
    let inherited = context.context.inherited;
    let requirements_catalogue =
        access_rights_object(access_rights_member(Some(&raw.merged), "requirements"));
    let mut uses = Vec::new();

    // The inherited entries flatten each node's list in order, so an item's index counts within
    // its node.
    let mut index_in_node: HashMap<TreeNodeId, usize> = HashMap::new();

    for written in inherited
        .ordered(input.route.node, OrderedSetting::Requires)?
        .unwrap_or_default()
    {
        let index = index_in_node.get(&written.node).copied().unwrap_or(0);

        index_in_node.insert(written.node, index + 1);

        let node_pointer = &context.nodes.get(written.node)?.pointer;
        let use_pointer = pointer_below(node_pointer, &["requires", &index.to_string()]);
        let origin = written.origin.clone();

        if let JsonValue::String(entry_name) = written.value {
            let item = access_rights_member(requirements_catalogue, entry_name)
                .filter(|item| access_rights_object(Some(item)).is_some());
            let Some(item) = item else {
                reporter.error(AccessRightsProblem {
                    rule: AccessRightsRule::RequirementEntry,
                    message: format!(
                        "'{}' names no entry of the requirements catalogue",
                        access_rights_quoted(entry_name)
                    ),
                    fix: "declare it under 'requirements', or write the requirement as an item ({ right } or { rule })".to_owned(),
                    pointer: use_pointer,
                    distinct_by: None,
                    related: Vec::new(),
                });

                continue;
            };
            let item_pointer = pointer_below("/requirements", &[entry_name]);
            let target = target_of(item, &item_pointer)?;

            uses.push(RequirementUse {
                kind: target.kind,
                target: target.target,
                item,
                item_pointer,
                use_pointer,
                entry: Some(entry_name.clone()),
                origin: Some(origin),
                derived_from: None,
            });

            continue;
        }

        let target = target_of(written.value, &use_pointer)?;

        uses.push(RequirementUse {
            kind: target.kind,
            target: target.target,
            item: written.value,
            item_pointer: use_pointer.clone(),
            use_pointer,
            entry: None,
            origin: Some(origin),
            derived_from: None,
        });
    }

    Ok(uses)
}

pub(crate) fn target_of(_item: &JsonValue, _pointer: &str) -> Result<RequirementTarget, PassError> {
    Err(not_ported_yet("targetOf"))
}

pub(crate) fn check_item(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsItemChecks,
    _use: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    Err(not_ported_yet("checkItem"))
}

pub(crate) fn check_target_and_params(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    Err(not_ported_yet("checkTargetAndParams"))
}

pub(crate) fn check_bucket(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &RequirementUse<'_>,
    _rule: Option<&Rule>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkBucket"))
}

pub(crate) fn requirement_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsRequiresInput<'_, '_>,
    _use: &RequirementUse<'_>,
    _params: Option<&JsonValue>,
) -> Result<Option<Requirement>, PassError> {
    Err(not_ported_yet("requirementOf"))
}

pub(crate) fn check_guest(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _right: &seampact_ir::Right,
    _use: &RequirementUse<'_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkGuest"))
}

pub(crate) fn equality_key(_requirement: &Requirement) -> Result<String, PassError> {
    Err(not_ported_yet("equalityKey"))
}

pub(crate) fn without_repeats(
    reporter: &mut AccessRightsReporter,
    built: &[BuiltRequirement<'_>],
) -> Result<Vec<Requirement>, InternalError> {
    let mut written_keys: HashSet<&str> = HashSet::new();

    for candidate in built {
        if candidate.use_of.derived_from.is_none() {
            written_keys.insert(candidate.key.as_str());
        }
    }

    let mut kept: Vec<&BuiltRequirement<'_>> = Vec::new();

    for candidate in built {
        let derived = candidate.use_of.derived_from.is_some();

        if derived && written_keys.contains(candidate.key.as_str()) {
            continue;
        }

        let Some(earlier) = kept.iter().find(|earlier| earlier.key == candidate.key) else {
            kept.push(candidate);

            continue;
        };
        let (kind, name) = match KnownRequirementRef::try_from(&candidate.requirement)? {
            KnownRequirementRef::Right(right) => ("right", right.right.as_str()),
            KnownRequirementRef::Rule(rule) => ("rule", rule.rule.as_str()),
        };

        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RequirementTwice,
            message: format!("the route requires {kind} '{name}' twice with equal params"),
            fix: "remove one of the two requirements".to_owned(),
            pointer: candidate.use_of.use_pointer.clone(),
            distinct_by: None,
            related: vec![AccessRightsRelated {
                pointer: earlier.use_of.use_pointer.clone(),
                message: "first required here".to_owned(),
            }],
        });
    }

    Ok(kept
        .into_iter()
        .map(|built| built.requirement.clone())
        .collect())
}

pub(crate) fn check_caller_right(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsRequiresInput<'_, '_>,
    _requirements: &[Requirement],
) -> Result<(), PassError> {
    Err(not_ported_yet("checkCallerRight"))
}
