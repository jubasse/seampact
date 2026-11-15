//! The lifecycle members of an operation: budget, deprecation, upstream services, maturity, internal, tags and extensions.

use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_diagnostics::{DiagnosticOrigin, InternalError, quote_text};
use seampact_ir::{
    ApiKind, DeclarationKind, Deprecation, ExtensionKey, ExtensionPrefix, Extensions, IrMap,
    MaturitySource, OperationId, OperationMaturity, OperationRef, Origin, Reason,
    is_ir_same_type_use,
};
use seampact_js::{cmp_utf16, js_key_order};
use seampact_json::{JsonObject, JsonValue, js_text_of};
use seampact_pass_tree_shared::{
    TREE_NODES_BATCH_OP, TREE_NODES_MATURITIES, tree_nodes_member, tree_nodes_op_shorthand,
};
use seampact_pipeline::{
    DraftOperation, InheritedEntry, NearestSetting, PassError, TreeNodeId, TreeNodes, UnionSetting,
    parse_duration,
};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::fields::TreeNodesSite;
use crate::formats::operation_id_of;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const SERVICE_API: ApiKind = ApiKind::Service;
const STATED: MaturitySource = MaturitySource::Stated;
/// The convention a batch's budget falls back to.
const BATCH_BUDGET: &str = "batch.budget";
const DEPRECATION_FIX: &str = "Write deprecated: { since: '<date>', sunset: '<date>' }.";

/// Which member of `deprecated` a refusal points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeprecationMember {
    Since,
    Sunset,
}

impl DeprecationMember {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Since => "since",
            Self::Sunset => "sunset",
        }
    }
}

/// The rule a deprecation refusal reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeprecationRule {
    DeprecatedSince,
    DeprecatedSunset,
}

impl DeprecationRule {
    const fn as_str(self) -> &'static str {
        match self {
            Self::DeprecatedSince => "deprecated-since",
            Self::DeprecatedSunset => "deprecated-sunset",
        }
    }

    const fn rule(self) -> TreeNodesRule {
        match self {
            Self::DeprecatedSince => TreeNodesRule::DeprecatedSince,
            Self::DeprecatedSunset => TreeNodesRule::DeprecatedSunset,
        }
    }
}

/// A refused deprecation.
#[derive(Debug, Clone)]
struct DeprecationRefusal {
    rule: DeprecationRule,
    /// The member the refusal points at; absent, the refusal points at `deprecated`.
    member: Option<DeprecationMember>,
    message: String,
    fix: String,
}

/// The extensions of a node by prefix and then key.
type ExtensionValues = IndexMap<String, IndexMap<String, JsonValue>>;

/// The extension values written on one mapping (the `api` block).
pub(crate) fn tree_nodes_own_extensions(written: Option<&JsonValue>) -> Extensions {
    let mut values = ExtensionValues::new();

    add_extensions(written, &mut values);

    extensions_of(&values)
}
fn extensions_of(values: &ExtensionValues) -> Extensions {
    values
        .iter()
        .map(|(prefix, keys)| {
            let slot: IrMap<ExtensionKey, JsonValue> = keys
                .iter()
                .map(|(key, value)| (ExtensionKey::new(key.clone()), value.clone()))
                .collect();

            (ExtensionPrefix::new(prefix.clone()), slot)
        })
        .collect()
}
// tree.schemas has checked each value against its declaration. The key may be `__proto__`, which an
// ordered map holds like any other.
fn add_extensions(written: Option<&JsonValue>, values: &mut ExtensionValues) {
    if let Some(JsonValue::Object(written)) = written {
        add_object_extensions(written, values);
    }
}

fn add_object_extensions(written: &JsonObject, values: &mut ExtensionValues) {
    for (key, value) in js_key_order(written.iter()) {
        let Some((prefix, name)) = extension_key_parts(key) else {
            continue;
        };

        values
            .entry(prefix.to_owned())
            .or_default()
            .insert(name.to_owned(), value.clone());
    }
}

/// The prefix and the name of an extension key, `x-<prefix>-<name>`: the TypeScript's
/// `/^x-([a-z][a-z0-9]*)-(.+)$/`.
pub(crate) fn extension_key_parts(key: &str) -> Option<(&str, &str)> {
    let rest = key.strip_prefix("x-")?;
    let first = rest.chars().next()?;

    if !first.is_ascii_lowercase() {
        return None;
    }

    let prefix_end = rest
        .find(|character: char| !(character.is_ascii_lowercase() || character.is_ascii_digit()))?;
    let (prefix, from_dash) = rest.split_at(prefix_end);
    let name = from_dash.strip_prefix('-')?;
    let has_line_terminator = name.contains(['\n', '\r', '\u{2028}', '\u{2029}']);

    (!name.is_empty() && !has_line_terminator).then_some((prefix, name))
}
/// The extension values that reach a tree node, `{ <prefix>: { <key>: value } }`, the nearest of each key.
pub(crate) fn tree_nodes_extensions(
    node_id: TreeNodeId,
    nodes: &TreeNodes<'_>,
) -> Result<Extensions, InternalError> {
    let mut values = ExtensionValues::new();

    for (_, at) in nodes.chain(node_id)? {
        add_object_extensions(at.settings, &mut values);
    }

    Ok(extensions_of(&values))
}
/// The union of the `tags` from the root down, each once.
pub(crate) fn tree_nodes_tags(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<String>, InternalError> {
    let entries = scope
        .context
        .inherited
        .union(site.node_id, UnionSetting::Tags)?
        .unwrap_or_default();
    let mut tags: Vec<String> = Vec::new();

    for entry in entries {
        let written: &[JsonValue] = match entry.value {
            JsonValue::Array(items) => items,
            single => std::slice::from_ref(single),
        };

        for tag in written {
            if let JsonValue::String(tag) = tag
                && !tags.contains(tag)
            {
                tags.push(tag.clone());
            }
        }
    }

    Ok(tags)
}
/// The nearest `upstream`, each service declared in `services`.
pub(crate) fn tree_nodes_upstream(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<String>, PassError> {
    let inherited = scope.context.inherited;
    let raw = scope.context.raw;
    let Some(entry) = inherited.nearest(site.node_id, &NearestSetting::Upstream)? else {
        return Ok(Vec::new());
    };
    let JsonValue::Array(written) = entry.value else {
        return Ok(Vec::new());
    };
    let services = raw.merged.get("services");
    let mut upstream: Vec<String> = Vec::new();

    for (index, service) in written.iter().enumerate() {
        let JsonValue::String(service) = service else {
            return Err(InternalError::new(format!(
                "the upstream at {} holds no service name",
                entry.origin.pointer
            ))
            .into());
        };
        let declared =
            matches!(services, Some(JsonValue::Object(declared)) if declared.contains_key(service));

        if !declared {
            report_unknown_service(site, service, &entry, index, scope)?;
        }

        upstream.push(service.clone());
    }

    Ok(upstream)
}

/// The nearest `internal`, false when unset; a service api has no documents to keep a route out of.
pub(crate) fn tree_nodes_internal(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    let inherited = scope.context.inherited;
    let Some(entry) = inherited.nearest(site.node_id, &NearestSetting::Internal)? else {
        return Ok(false);
    };
    let service_api_id = scope
        .output
        .api
        .as_ref()
        .filter(|api| api.kind == SERVICE_API)
        .map(|api| api.id.clone());

    if let Some(api_id) = service_api_id {
        let key = format!(
            "internal-product:{}#{}",
            entry.origin.layer, entry.origin.pointer
        );
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::InternalProduct,
            origin: tree_nodes_node_origin(&entry.origin)?,
            message: format!(
                "The service api {api_id} writes internal, which only a product api's documents read."
            ),
            fix: "Remove internal; a service api is internal as a whole.".to_owned(),
            related: Vec::new(),
        });

        tree_nodes_report_once(&key, diagnostic, scope);
    }

    Ok(*entry.value == JsonValue::Bool(true))
}

/// A stated `maturity`, the nearest; derive.wire derives the others.
pub(crate) fn tree_nodes_stated_maturity(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<OperationMaturity>, PassError> {
    let Some(entry) = scope
        .context
        .inherited
        .nearest(site.node_id, &NearestSetting::Maturity)?
    else {
        return Ok(None);
    };
    let written = match entry.value {
        JsonValue::Object(_) => tree_nodes_member(Some(entry.value), "level"),
        whole => Some(whole),
    };
    let level = TREE_NODES_MATURITIES
        .iter()
        .find(|candidate| written == Some(&JsonValue::String(candidate.as_str().to_owned())));
    let Some(level) = level else {
        return Err(InternalError::new(format!(
            "the maturity at {} is no level the grammar admits",
            entry.origin.pointer
        ))
        .into());
    };
    let reason = match tree_nodes_member(Some(entry.value), "reason") {
        Some(JsonValue::String(reason)) => Some(Reason::new(reason.clone())),
        _ => None,
    };

    Ok(Some(OperationMaturity {
        level: level.clone(),
        source: STATED,
        reason,
        origin: entry.origin,
    }))
}

/// `budget` in milliseconds: the nearest, else `conventions.batch.budget` for a batch.
pub(crate) fn tree_nodes_budget_ms(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<i64>, PassError> {
    let inherited = scope.context.inherited;
    let conventions = scope.context.conventions;
    let is_batch = tree_nodes_op_shorthand(site.node) == Some(TREE_NODES_BATCH_OP);
    let entry = inherited.nearest(site.node_id, &NearestSetting::Budget)?;
    let reading = if is_batch {
        conventions.get(BATCH_BUDGET)?
    } else {
        None
    };
    // The TypeScript's `??`: a written null falls through to the convention.
    let written = match &entry {
        Some(entry) if *entry.value != JsonValue::Null => Some(entry.value),
        _ => reading.as_ref().map(|reading| reading.value),
    };
    let origin = entry
        .as_ref()
        .map(|entry| entry.origin.clone())
        .or_else(|| reading.and_then(|reading| reading.origin));
    let Some(written) = written else {
        return Ok(None);
    };

    if let JsonValue::String(text) = written
        && let Some(milliseconds) = parse_duration(text)?
    {
        let budget = i64::try_from(milliseconds).map_err(|_| {
            InternalError::new(format!(
                "the budget {text} of {} does not fit in 64 bits",
                site.operation_id
            ))
        })?;

        return Ok(Some(budget));
    }

    let Some(origin) = origin else {
        return Err(InternalError::new(format!(
            "the core budget of {} does not parse",
            site.operation_id
        ))
        .into());
    };
    let key = format!("budget-duration:{}#{}", origin.layer, origin.pointer);
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::BudgetDuration,
        origin: tree_nodes_node_origin(&origin)?,
        message: format!(
            "The budget {} of {} is too long to hold in milliseconds.",
            js_text_of(Some(written)),
            site.operation_id
        ),
        fix: "Write a shorter budget.".to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(None)
}

/// The nearest `deprecated` whose dates hold; its successor is checked once every operation is written.
pub(crate) fn tree_nodes_deprecated(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Deprecation>, PassError> {
    let inherited = scope.context.inherited;
    let Some(entry) = inherited.nearest(site.node_id, &NearestSetting::Deprecated)? else {
        return Ok(None);
    };
    let since = tree_nodes_member(Some(entry.value), "since");
    let sunset = tree_nodes_member(Some(entry.value), "sunset");
    let successor = tree_nodes_member(Some(entry.value), "successor");
    let dates_hold = deprecation_dates_hold(site, &entry.origin, since, sunset, scope)?;

    let (true, Some(JsonValue::String(since)), Some(JsonValue::String(sunset))) =
        (dates_hold, since, sunset)
    else {
        return Ok(None);
    };
    let Some(api_id) = scope.output.api.as_ref().map(|api| api.id.clone()) else {
        return Err(InternalError::new("write the api before its operations").into());
    };
    let (successor, successor_rel) = match successor {
        Some(JsonValue::String(id)) => (
            Some(OperationRef {
                kind: DeclarationKind::HttpOperation,
                api: api_id,
                id: OperationId::new(id.clone()),
            }),
            Some(successor_rel_of(scope)?),
        ),
        _ => (None, None),
    };

    Ok(Some(Deprecation {
        since: since.clone(),
        sunset: sunset.clone(),
        successor,
        successor_rel,
        origin: entry.origin,
    }))
}

/// A deprecated operation whose successor names no operation of the api, or one its path params cannot fill.
pub(crate) fn tree_nodes_check_successor(
    operation: &DraftOperation,
    operations: &[DraftOperation],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let (Some(id), Some(deprecated)) = (&operation.id, &operation.deprecated) else {
        return Ok(());
    };
    let Some(successor_id) = deprecated.successor.as_ref().map(|successor| &successor.id) else {
        return Ok(());
    };
    let pointer = format!("{}/successor", deprecated.origin.pointer);
    let located = scope
        .context
        .origin(&pointer)
        .unwrap_or_else(|| deprecated.origin.clone());
    let origin = tree_nodes_node_origin(&located)?;
    let successor = operations
        .iter()
        .find(|candidate| candidate.id.as_ref() == Some(successor_id));

    if let Some(successor) = successor {
        return report_successor_params(&origin, operation, successor, scope);
    }

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::DeprecatedSuccessor,
            origin,
            message: format!("The successor {successor_id} of {id} is no operation of the api."),
            fix: "Name the operation id of the route that replaces this one.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

// The successor `Link` relation, `successor-version` unless `conventions.deprecation.successorRel` renames it.
fn successor_rel_of(scope: &TreeNodesScope<'_, '_, '_>) -> Result<String, PassError> {
    let reading = scope.context.conventions.get("deprecation.successorRel")?;
    let Some(JsonValue::String(rel)) = reading.map(|reading| reading.value) else {
        return Err(InternalError::new(
            "conventions.deprecation.successorRel has no text, which its default gives",
        )
        .into());
    };

    Ok(rel.clone())
}

// Each refusal is reported once per written `deprecated`, however many operations inherit it.
fn deprecation_dates_hold(
    site: &TreeNodesSite<'_, '_>,
    origin: &Origin,
    since: Option<&JsonValue>,
    sunset: Option<&JsonValue>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    let since_holds = since_is_date(site, origin, since, scope)?;
    let sunset_holds = sunset_is_date(site, origin, sunset, scope)?;

    if !since_holds || !sunset_holds {
        return Ok(false);
    }

    let (Some(JsonValue::String(since)), Some(JsonValue::String(sunset))) = (since, sunset) else {
        return Ok(true);
    };

    if cmp_utf16(since, sunset) != Ordering::Greater {
        return Ok(true);
    }

    report_deprecation(
        origin,
        &DeprecationRefusal {
            rule: DeprecationRule::DeprecatedSince,
            member: Some(DeprecationMember::Since),
            message: format!(
                "The deprecation that reaches {} starts on {}, after its sunset {}.",
                site.operation_id,
                quote_text(since),
                quote_text(sunset)
            ),
            fix: "Write a since date on or before the sunset date.".to_owned(),
        },
        scope,
    )?;

    Ok(false)
}

fn since_is_date(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _since: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sinceIsDate"))
}

fn sunset_is_date(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _sunset: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sunsetIsDate"))
}

fn report_successor_params(
    origin: &DiagnosticOrigin,
    operation: &DraftOperation,
    successor: &DraftOperation,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation_id = operation_id_of(operation)?;
    let successor_id = operation_id_of(successor)?;
    let own_path_params = operation
        .params
        .as_ref()
        .map_or(&[][..], |params| params.path.as_slice());
    let successor_path_params = successor
        .params
        .as_ref()
        .map_or(&[][..], |params| params.path.as_slice());

    for param in successor_path_params {
        let own = own_path_params
            .iter()
            .find(|candidate| candidate.name == param.name);

        if let Some(own) = own
            && is_ir_same_type_use(&own.r#type, &param.r#type)?
        {
            continue;
        }

        let why = if own.is_none() {
            format!("which {operation_id} has not")
        } else {
            format!("typed otherwise than on {operation_id}")
        };

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::DeprecatedSuccessorParams,
                origin: origin.clone(),
                message: format!(
                    "The successor {successor_id} of {operation_id} has the path param {}, {why}.",
                    param.name
                ),
                fix: format!(
                    "Name a successor whose path params are path params of {operation_id}, of the same type."
                ),
                related: Vec::new(),
            }));
    }

    Ok(())
}

fn report_deprecation(
    origin: &Origin,
    refusal: &DeprecationRefusal,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let pointer = match refusal.member {
        None => origin.pointer.clone(),
        Some(member) => format!("{}/{}", origin.pointer, member.as_str()),
    };
    let located = scope
        .context
        .origin(&pointer)
        .unwrap_or_else(|| origin.clone());
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: refusal.rule.rule(),
        origin: tree_nodes_node_origin(&located)?,
        message: refusal.message.clone(),
        fix: refusal.fix.clone(),
        related: Vec::new(),
    });

    tree_nodes_report_once(
        &format!("{}:{}#{pointer}", refusal.rule.as_str(), origin.layer),
        diagnostic,
        scope,
    );

    Ok(())
}

fn report_unknown_service(
    _site: &TreeNodesSite<'_, '_>,
    _service: &str,
    _entry: &InheritedEntry<'_>,
    _index: usize,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportUnknownService"))
}
