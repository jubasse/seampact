//! The lifecycle members of an operation: budget, deprecation, upstream services, maturity, internal, tags and extensions.

use indexmap::IndexMap;
use seampact_diagnostics::DiagnosticOrigin;
use seampact_ir::{
    ApiKind, Deprecation, ExtensionKey, ExtensionPrefix, Extensions, IrMap, MaturitySource,
    OperationMaturity, Origin,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_diagnostics::InternalError;
use seampact_pipeline::{
    DraftOperation, InheritedEntry, PassError, TreeNodeId, TreeNodes, UnionSetting,
};

use crate::fields::TreeNodesSite;
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

/// The rule a deprecation refusal reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeprecationRule {
    DeprecatedSince,
    DeprecatedSunset,
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
    for (key, value) in written.iter() {
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
fn extension_key_parts(key: &str) -> Option<(&str, &str)> {
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
pub(crate) fn tree_nodes_upstream(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("treeNodesUpstream"))
}

pub(crate) fn tree_nodes_internal(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("treeNodesInternal"))
}

pub(crate) fn tree_nodes_stated_maturity(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<OperationMaturity>, PassError> {
    Err(not_ported_yet("treeNodesStatedMaturity"))
}

pub(crate) fn tree_nodes_budget_ms(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<i64>, PassError> {
    Err(not_ported_yet("treeNodesBudgetMs"))
}

pub(crate) fn tree_nodes_deprecated(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Deprecation>, PassError> {
    Err(not_ported_yet("treeNodesDeprecated"))
}

pub(crate) fn tree_nodes_check_successor(
    _operation: &DraftOperation,
    _operations: &[DraftOperation],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckSuccessor"))
}

fn successor_rel_of(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<String, PassError> {
    Err(not_ported_yet("successorRelOf"))
}

fn deprecation_dates_hold(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _since: Option<&JsonValue>,
    _sunset: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deprecationDatesHold"))
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
    _origin: &DiagnosticOrigin,
    _operation: &DraftOperation,
    _successor: &DraftOperation,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSuccessorParams"))
}

fn report_deprecation(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _refusal: &DeprecationRefusal,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportDeprecation"))
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
