//! The requirements of a route: written and pack-derived, each target, params, subject and
//! bucket checked (ADR 0002 section 9).

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    BucketId, DerivationId, DerivedFrom, KnownRequirement, KnownRequirementRef,
    KnownRightSubjectRef, OperationScope, Origin, Requirement, Right, RightRequirement, Rule,
    RuleId, RuleRequirement, ValueSource,
};
use seampact_json::{JsonNumber, JsonObject, JsonValue, canonical_json, object_of};
use seampact_pipeline::{OrderedSetting, PassError, TreeNodeId, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::packs::{
    AccessRightsDeriveEntry, AccessRightsTemplate, access_rights_expand, access_rights_selects,
};
use crate::params::{
    AccessRightsCheckedParams, AccessRightsParamsKind, AccessRightsParamsUse,
    access_rights_check_params,
};
use crate::read::{access_rights_member, access_rights_origin_of, access_rights_string};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{AccessRightsAccessKind, AccessRightsApi, AccessRightsRoute};
use crate::schema_use::AccessRightsContext;
use crate::subjects::{
    AccessRightsSubjectInput, AccessRightsSubjectResult, AccessRightsWrittenSubject,
    access_rights_subject,
};

/// What a requirement item names: a right or a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequirementKind {
    Right,
    Rule,
}

impl RequirementKind {
    /// The word a message and a key use for the kind.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Right => "right",
            Self::Rule => "rule",
        }
    }
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
/// An internal error.
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
        check_caller_right(context, reporter, catalogues, input, &requirements)?;
    }

    Ok(requirements)
}

/// Checks every entry of the `requirements` catalogue once, used or not: its target, params and
/// bucket. A use of an entry then finds it checked.
///
/// # Errors
///
/// An internal error.
pub(crate) fn access_rights_check_requirement_entries(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsItemChecks,
) -> Result<(), PassError> {
    let raw = context.context.raw;
    let Some(entries) = object_of(access_rights_member(Some(&raw.merged), "requirements")) else {
        return Ok(());
    };

    for (name, item) in entries {
        if object_of(Some(item)).is_none() {
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
        let Some((kind, target)) =
            derived_target(context, reporter, require, &pointer, input.route)?
        else {
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
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    require: &JsonValue,
    pointer: &str,
    route: &AccessRightsRoute,
) -> Result<Option<(RequirementKind, String)>, PassError> {
    let require = object_of(Some(require));

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
        context,
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
    let requirements_catalogue = object_of(access_rights_member(Some(&raw.merged), "requirements"));
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
                .filter(|item| object_of(Some(item)).is_some());
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

/// The authoring schema requires an item to name a right or a rule.
///
/// # Errors
///
/// An internal error for an item that names neither.
pub(crate) fn target_of(
    item: &JsonValue,
    pointer: &str,
) -> Result<RequirementTarget, InternalError> {
    let item = object_of(Some(item));

    if let Some(right) = access_rights_string(item, "right") {
        return Ok(RequirementTarget {
            kind: RequirementKind::Right,
            target: right.to_owned(),
        });
    }

    let Some(rule) = access_rights_string(item, "rule") else {
        return Err(InternalError::new(format!(
            "the requirement item at {pointer} names neither a right nor a rule"
        )));
    };

    Ok(RequirementTarget {
        kind: RequirementKind::Rule,
        target: rule.to_owned(),
    })
}

/// The route-independent checks of an item: its target exists, its params fit, its bucket is
/// allowed and declared. Each item is checked once, whatever the routes that use it.
pub(crate) fn check_item(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsItemChecks,
    use_of: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    let key = format!(
        "{}\n{}\n{}",
        use_of.item_pointer,
        use_of.kind.as_str(),
        use_of.target
    );

    if let Some(checked) = checks.checked.get(&key) {
        return Ok(checked.clone());
    }

    let result = check_target_and_params(context, reporter, catalogues, use_of)?;

    checks.checked.insert(key, result.clone());

    Ok(result)
}

pub(crate) fn check_target_and_params(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    use_of: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    let kind = use_of.kind.as_str();
    let target = use_of.target.as_str();
    let (params_schema, params_kind) = match use_of.kind {
        RequirementKind::Right => (
            catalogues
                .rights
                .get(target)
                .map(|right| right.params.as_ref()),
            AccessRightsParamsKind::Right,
        ),
        RequirementKind::Rule => (
            catalogues
                .rules
                .get(target)
                .map(|rule| rule.params.as_ref()),
            AccessRightsParamsKind::Rule,
        ),
    };
    let Some(params_schema) = params_schema else {
        let declared = match use_of.kind {
            RequirementKind::Right => &catalogues.declared.rights,
            RequirementKind::Rule => &catalogues.declared.rules,
        };

        if !declared.contains(target) {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::RequirementTarget,
                message: format!(
                    "the requirement names {kind} '{target}', which the {kind}s catalogue does not declare"
                ),
                fix: format!("declare the {kind} in '{kind}s', or name a declared one"),
                pointer: pointer_below(&use_of.item_pointer, &[kind]),
                distinct_by: None,
                related: Vec::new(),
            });
        }

        return Ok(None);
    };

    if use_of.kind == RequirementKind::Rule
        && !check_bucket(reporter, catalogues, use_of, catalogues.rules.get(target))
    {
        return Ok(None);
    }

    access_rights_check_params(
        context,
        reporter,
        &AccessRightsParamsUse {
            rule: AccessRightsRule::RequirementParams,
            kind: params_kind,
            name: use_of.target.clone(),
            holder: "the requirement".to_owned(),
            schema: params_schema.map(|schema| schema.as_str().to_owned()),
            params: access_rights_member(object_of(Some(use_of.item)), "params").cloned(),
            params_pointer: pointer_below(&use_of.item_pointer, &["params"]),
            use_pointer: use_of.item_pointer.clone(),
        },
    )
}

/// A rule declared with `bucket: true` takes a declared bucket at each use; any other rule takes
/// none.
pub(crate) fn check_bucket(
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    use_of: &RequirementUse<'_>,
    rule: Option<&Rule>,
) -> bool {
    let bucket = access_rights_string(object_of(Some(use_of.item)), "bucket");
    let pointer = pointer_below(&use_of.item_pointer, &["bucket"]);
    let target = &use_of.target;

    if !rule.is_some_and(|rule| rule.takes_bucket) {
        if bucket.is_none() {
            return true;
        }

        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RequirementBucket,
            message: format!(
                "rule '{target}' takes no bucket; only a rule declared with 'bucket: true' does"
            ),
            fix: "remove 'bucket', or declare the rule with 'bucket: true'".to_owned(),
            pointer,
            distinct_by: None,
            related: Vec::new(),
        });

        return false;
    }

    let Some(bucket) = bucket else {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RequirementBucket,
            message: format!(
                "rule '{target}' is declared with 'bucket: true', so each use names a bucket"
            ),
            fix: "name a declared bucket in the requirement's 'bucket'".to_owned(),
            pointer: use_of.item_pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return false;
    };

    if catalogues.buckets.contains_key(bucket) {
        return true;
    }

    if !catalogues.declared.buckets.contains(bucket) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RequirementBucket,
            message: format!(
                "the requirement counts in bucket '{bucket}', which the buckets catalogue does not declare"
            ),
            fix: "declare the bucket in 'buckets', or name a declared one".to_owned(),
            pointer,
            distinct_by: None,
            related: Vec::new(),
        });
    }

    false
}

/// The route-dependent part: a right's subject and the guest rule.
pub(crate) fn requirement_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    input: &AccessRightsRequiresInput<'_, '_>,
    use_of: &RequirementUse<'_>,
    params: Option<&JsonValue>,
) -> Result<Option<Requirement>, PassError> {
    let params = params.cloned();
    let entry = use_of.entry.clone();
    let origin = use_of.origin.clone();
    let derived_from = use_of.derived_from.clone();
    let item = object_of(Some(use_of.item));

    if use_of.kind == RequirementKind::Rule {
        return Ok(Some(
            KnownRequirement::Rule(RuleRequirement {
                rule: RuleId::new(use_of.target.clone()),
                params,
                bucket: access_rights_string(item, "bucket")
                    .map(|bucket| BucketId::new(bucket.to_owned())),
                entry,
                origin,
                derived_from,
            })
            .into(),
        ));
    }

    let Some(right) = catalogues.rights.get(use_of.target.as_str()) else {
        return Ok(None);
    };

    if !check_guest(context, reporter, input.route, right, use_of)? {
        return Ok(None);
    }

    let scope_refused = match KnownRightSubjectRef::try_from(&right.subject)? {
        KnownRightSubjectRef::Scope(subject) => {
            !catalogues.scopes.contains_key(subject.scope.as_str())
        }
        KnownRightSubjectRef::NoSubject(_) | KnownRightSubjectRef::Resource(_) => false,
    };
    let written = access_rights_string(item, "subject").map(|text| AccessRightsWrittenSubject {
        text: text.to_owned(),
        pointer: pointer_below(&use_of.item_pointer, &["subject"]),
    });
    let resolved = access_rights_subject(
        context,
        reporter,
        &AccessRightsSubjectInput {
            route: input.route.clone(),
            right: right.clone(),
            id_name: catalogues.right_id_names.get(right.id.as_str()).cloned(),
            scopes: input.scopes.to_vec(),
            scope_refused,
            schemas: input.schemas,
            written,
            use_pointer: use_of.use_pointer.clone(),
        },
    )?;
    let AccessRightsSubjectResult::Resolved { subject } = resolved else {
        return Ok(None);
    };

    Ok(Some(
        KnownRequirement::Right(RightRequirement {
            right: right.id.clone(),
            params,
            subject,
            entry,
            origin,
            derived_from,
        })
        .into(),
    ))
}

/// A right reaches an anonymous caller on a public or optional-auth route only when it is
/// guest-enabled, unless `conventions.access.guestRule` is `allow`.
///
/// # Errors
///
/// An internal error from the convention reader.
pub(crate) fn check_guest(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    right: &Right,
    use_of: &RequirementUse<'_>,
) -> Result<bool, InternalError> {
    if route.access == AccessRightsAccessKind::Identity || right.guest.is_some() {
        return Ok(true);
    }

    let guest_rule = context.context.conventions.get("access.guestRule")?;

    if guest_rule.is_some_and(|reading| reading.value == &JsonValue::String("allow".to_owned())) {
        return Ok(true);
    }

    // A pack derived the right or the requirement: the author changes the entry's selector or
    // declares the right.
    let derived = right.derived_from.is_some() || use_of.derived_from.is_some();
    let kind = if route.access == AccessRightsAccessKind::Public {
        "public"
    } else {
        "optional-auth"
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::GuestRight,
        message: format!(
            "right '{}' is required on {kind} route '{}', where an anonymous caller reaches it, and the right has no 'guest' reason",
            right.id, route.id
        ),
        fix: if derived {
            "narrow the entry's 'select' to identified routes, or declare the right in 'rights' with a 'guest' reason"
        } else {
            "set the right's 'guest' to the reason an anonymous caller may reach it, or require it on an identified route"
        }
        .to_owned(),
        pointer: use_of.use_pointer.clone(),
        distinct_by: None,
        related: route
            .access_pointer
            .iter()
            .map(|pointer| AccessRightsRelated {
                pointer: pointer.clone(),
                message: "the route's access is set here".to_owned(),
            })
            .collect(),
    });

    Ok(false)
}

/// Two requirements are the same when they name the same right or rule with equal params, bucket
/// and subject; no params and empty params are equal, as both are checked as `{}`.
///
/// # Errors
///
/// An internal error for a requirement or source of a kind this revision does not know.
pub(crate) fn equality_key(requirement: &Requirement) -> Result<String, InternalError> {
    let (kind, name, params, bucket, source) = match KnownRequirementRef::try_from(requirement)? {
        KnownRequirementRef::Right(right) => (
            "right",
            right.right.as_str(),
            &right.params,
            JsonValue::Null,
            right
                .subject
                .as_ref()
                .map_or(JsonValue::Null, |subject| source_json_of(&subject.source)),
        ),
        KnownRequirementRef::Rule(rule) => (
            "rule",
            rule.rule.as_str(),
            &rule.params,
            rule.bucket.as_ref().map_or(JsonValue::Null, |bucket| {
                JsonValue::String(bucket.as_str().to_owned())
            }),
            JsonValue::Null,
        ),
    };
    let params = params
        .clone()
        .unwrap_or_else(|| JsonValue::Object(JsonObject::new()));

    Ok(canonical_json(&JsonValue::Array(vec![
        JsonValue::String(kind.to_owned()),
        JsonValue::String(name.to_owned()),
        params,
        bucket,
        source,
    ])))
}

fn source_json_of(source: &ValueSource) -> JsonValue {
    let mut object = JsonObject::new();

    object.insert("in".to_owned(), JsonValue::String(source.r#in.to_string()));

    if let Some(name) = &source.name {
        object.insert("name".to_owned(), JsonValue::String(name.clone()));
    }

    if let Some(prefix_bits) = source.prefix_bits {
        object.insert(
            "prefixBits".to_owned(),
            JsonValue::Number(JsonNumber::from_i64(prefix_bits)),
        );
    }

    JsonValue::Object(object)
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

/// Every route of a service api requires the api's caller right (ADR 0002 section 5). A caller
/// right whose declaration is refused already has its error.
pub(crate) fn check_caller_right(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    input: &AccessRightsRequiresInput<'_, '_>,
    requirements: &[Requirement],
) -> Result<(), PassError> {
    let Some(caller) = &input.api.caller else {
        return Ok(());
    };

    if input.api.kind != "service" {
        return Ok(());
    }

    if !catalogues.rights.contains_key(caller.right.as_str())
        && catalogues.declared.rights.contains(&caller.right)
    {
        return Ok(());
    }

    for requirement in requirements {
        if let KnownRequirementRef::Right(right) = KnownRequirementRef::try_from(requirement)?
            && right.right.as_str() == caller.right
        {
            return Ok(());
        }
    }

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::CallerRight,
        message: format!(
            "route '{}' of the service api does not require the caller right '{}'",
            input.route.id, caller.right
        ),
        fix: format!(
            "add {{ right: {} }} to the route's requires or an ancestor's",
            caller.right
        ),
        pointer: context.nodes.get(input.route.node)?.pointer.clone(),
        distinct_by: None,
        related: vec![AccessRightsRelated {
            pointer: "/api/caller/right".to_owned(),
            message: "the caller right is set here".to_owned(),
        }],
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use seampact_ir::{RequirementSubject, ValueSourceIn};

    use super::*;

    fn rule(params: Option<JsonValue>, bucket: Option<&str>) -> Requirement {
        KnownRequirement::Rule(RuleRequirement {
            rule: RuleId::new("quota".to_owned()),
            params,
            bucket: bucket.map(|name| BucketId::new(name.to_owned())),
            entry: None,
            origin: None,
            derived_from: None,
        })
        .into()
    }

    fn right(source: ValueSource) -> Requirement {
        KnownRequirement::Right(RightRequirement {
            right: seampact_ir::RightId::new("tasks.read".to_owned()),
            params: None,
            subject: Some(RequirementSubject {
                source,
                defaulted: false,
            }),
            entry: None,
            origin: None,
            derived_from: None,
        })
        .into()
    }

    #[test]
    fn absent_params_and_empty_params_are_one_requirement() {
        let empty = JsonValue::Object(JsonObject::new());

        assert_eq!(
            equality_key(&rule(None, None)).unwrap(),
            equality_key(&rule(Some(empty), None)).unwrap()
        );
        assert_ne!(
            equality_key(&rule(None, Some("a"))).unwrap(),
            equality_key(&rule(None, Some("b"))).unwrap()
        );
    }

    #[test]
    fn params_compare_whatever_their_key_order() {
        let params = |text: &str| JsonValue::Object(mapping(text));

        assert_eq!(
            equality_key(&rule(Some(params("a,b")), None)).unwrap(),
            equality_key(&rule(Some(params("b,a")), None)).unwrap()
        );
    }

    fn mapping(keys: &str) -> JsonObject {
        let mut object = JsonObject::new();

        for key in keys.split(',') {
            object.insert(key.to_owned(), JsonValue::Bool(true));
        }

        object
    }

    #[test]
    fn a_right_key_reads_its_subject_source() {
        let source = |name: &str| ValueSource {
            r#in: ValueSourceIn::Path,
            name: Some(name.to_owned()),
            prefix_bits: None,
        };

        assert_ne!(
            equality_key(&right(source("id"))).unwrap(),
            equality_key(&right(source("taskId"))).unwrap()
        );
    }

    #[test]
    fn a_requirement_item_names_a_right_or_a_rule_or_is_an_internal_error() {
        let named = |key: &str| {
            let mut item = JsonObject::new();

            item.insert(key.to_owned(), JsonValue::String("x".to_owned()));

            JsonValue::Object(item)
        };

        assert_eq!(
            target_of(&named("right"), "/p").unwrap().kind,
            RequirementKind::Right
        );
        assert_eq!(
            target_of(&named("rule"), "/p").unwrap().kind,
            RequirementKind::Rule
        );
        assert!(target_of(&named("other"), "/p").is_err());
    }
}
