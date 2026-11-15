//! The `paging` member of an operation: the style it uses, its limits and token, and the sort keys of its item.

use seampact_diagnostics::{InternalError, RelatedLocation};
use seampact_ir::{
    Origin, OverLimitPolicy, Paging, PagingId, PagingParamStyle, PagingToken, Param, Response,
    SortKey, TypeUse,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, js_integer_in_range};
use seampact_pass_tree_shared::{tree_nodes_member, tree_nodes_object_of};
use seampact_pipeline::PassError;

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pagings::TREE_NODES_DEFAULT_SORT_STYLE;
use crate::pass::TreeNodesScope;
use crate::responses::{TREE_NODES_PAGING_NONE, tree_nodes_is_list};

const DEFAULT_OVER_LIMIT: OverLimitPolicy = OverLimitPolicy::Reject;
const OVER_LIMITS: &[OverLimitPolicy] = &[OverLimitPolicy::Reject, OverLimitPolicy::Clamp];
const TOKENS: &[PagingToken] = &[PagingToken::Opaque, PagingToken::Instant];
/// The token a cursor style gets when it writes none.
const DEFAULT_TOKEN: PagingToken = PagingToken::Opaque;
const LIMIT_ROLE: &str = "limit";
const SORT_ROLE: &str = "sort";
const SINCE_ROLE: &str = "since";
const SIGNED_SORT_STYLE: PagingParamStyle = PagingParamStyle::Signed;
const SIGNED_LIST_SEPARATOR: &str = ",";
const SIGNED_DESCENDING_PREFIX: &str = "-";
/// The fix a list with no paging style names. The shape is the api's own: the example is one page-numbers
/// style among many, not a default.
const PAGING_STYLE_FIX: &str = "Declare a paging style and name it, for example `pagings: { pages: { request: { page: { query: page }, limit: { query: limit } }, response: { body: { items: $items, meta: { page: $page, limit: $limit, total: $total } } } } }` with `paging: { pages: { maxLimit: 100 } }` on the list or `conventions: { paging: { default: pages, maxLimit: 100 } }`; or write `paging: none` to serve the whole list.";

/// The paging style a list uses, as written: its id, its route settings and where it is named.
#[derive(Debug, Clone)]
struct NamedStyle<'tree> {
    id: Option<String>,
    settings: Option<&'tree JsonValue>,
    origin: Origin,
    /// True when the route writes `paging`, false when it comes from `conventions.paging.default`.
    on_route: bool,
}

/// The limits and token a paging reads.
#[derive(Debug, Clone, PartialEq)]
struct Limits {
    max_limit: Option<i64>,
    default_limit: Option<i64>,
    over_limit: OverLimitPolicy,
    token: Option<PagingToken>,
}

/// The limits a route writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RouteLimits {
    max_limit: Option<i64>,
    default_limit: Option<i64>,
}

/// A limit a convention writes, with where it is written.
#[derive(Debug, Clone, PartialEq)]
struct ConventionLimit {
    value: i64,
    origin: Origin,
}

/// The limits the conventions write.
#[derive(Debug, Clone, PartialEq)]
struct ConventionLimits {
    max_limit: Option<ConventionLimit>,
    default_limit: Option<ConventionLimit>,
}

/// A default limit above the maximum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LimitPair {
    default_limit: i64,
    max_limit: i64,
}

fn refuse_outside_list(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    for member in ["paging", "sortable"] {
        if !site.node.settings.contains_key(member) {
            continue;
        }

        let origin = scope
            .context
            .origin(&format!("{}/{member}", site.node.pointer))
            .unwrap_or_else(|| site.node.origin.clone());

        scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PagingList,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The operation {} writes {member}, but it is no list.",
                site.operation_id
            ),
            fix: format!(
                "Remove {member}, or make the route a list (the list op, or item instead of output)."
            ),
            related: Vec::new(),
        }));
    }

    Ok(())
}

/// The paging of a list operation, `None` when the list has no style (reported).
///
/// A route that is no list and writes `paging` or `sortable` is refused.
pub(crate) fn tree_nodes_paging(
    site: &TreeNodesSite<'_, '_>,
    responses: &[Response],
    query: &[Param],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Paging>, PassError> {
    if !tree_nodes_is_list(site.node) {
        refuse_outside_list(site, scope)?;

        return Ok(None);
    }

    let Some(named) = named_style(site, scope)? else {
        return Ok(None);
    };
    let item = responses.iter().find_map(|response| response.body.as_ref());
    let sort_keys = sort_keys_of(site, item, scope)?;
    let Some(named_id) = named.id.as_deref() else {
        refuse_sort_without_role(site, &sort_keys, "an unpaged list", scope)?;

        return Ok(Some(Paging {
            style: None,
            max_limit: None,
            default_limit: None,
            over_limit: over_limit_of(&named, scope)?,
            token: None,
            sort_keys,
            origin: named.origin.clone(),
        }));
    };
    let Some(style) = declared_style(site, named_id, &named.origin, scope)? else {
        return Ok(None);
    };
    let roles = request_roles(style);

    if !roles.iter().any(|role| role == SORT_ROLE) {
        refuse_sort_without_role(site, &sort_keys, &format!("the style {named_id}"), scope)?;
    } else if sort_style_of(style) == Some(SIGNED_SORT_STYLE) {
        refuse_unsignable_keys(site, named_id, &sort_keys, scope)?;
    }

    refuse_taken_names(site, named_id, style, query, scope)?;

    let Some(limits) = limits_of(site, &named, &roles, scope)? else {
        return Ok(None);
    };

    Ok(Some(Paging {
        style: Some(PagingId::new(named_id.to_owned())),
        max_limit: limits.max_limit,
        default_limit: limits.default_limit,
        over_limit: limits.over_limit,
        token: limits.token,
        sort_keys,
        origin: named.origin,
    }))
}

// The style the route names (`cursor`, `{ cursor: { maxLimit } }`, `none`), else the convention's.
fn named_style<'raw>(
    site: &TreeNodesSite<'_, 'raw>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<NamedStyle<'raw>>, PassError> {
    let pointer = format!("{}/paging", site.node.pointer);

    if let Some(written) = site.node.settings.get("paging") {
        let Some(origin) = scope.context.origin(&pointer) else {
            return Err(
                InternalError::new(format!("the raw tree has no origin for {pointer}")).into(),
            );
        };

        return match written {
            JsonValue::String(text) if text == TREE_NODES_PAGING_NONE => Ok(Some(NamedStyle {
                id: None,
                settings: None,
                origin,
                on_route: true,
            })),
            JsonValue::String(text) => Ok(Some(NamedStyle {
                id: Some(text.clone()),
                settings: None,
                origin,
                on_route: true,
            })),
            JsonValue::Object(map) => {
                let Some((id, settings)) = js_key_order(map.iter()).next() else {
                    return Err(InternalError::new(format!(
                        "the paging at {pointer} names no style"
                    ))
                    .into());
                };

                Ok(Some(NamedStyle {
                    id: Some(id.clone()),
                    settings: Some(settings),
                    origin,
                    on_route: true,
                }))
            }
            _ => Err(InternalError::new(format!("the paging at {pointer} names no style")).into()),
        };
    }

    if let Some(reading) = scope.context.conventions.get("paging.default")?
        && let JsonValue::String(id) = reading.value
        && let Some(origin) = reading.origin
    {
        return Ok(Some(NamedStyle {
            id: Some(id.clone()),
            settings: None,
            origin,
            on_route: false,
        }));
    }

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PagingStyle,
            origin: tree_nodes_node_origin(&site.node.origin)?,
            message: format!(
                "The list {} names no paging style, and conventions.paging.default sets none.",
                site.operation_id
            ),
            fix: PAGING_STYLE_FIX.to_owned(),
            related: Vec::new(),
        }));

    Ok(None)
}

fn over_limit_of(
    named: &NamedStyle<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<OverLimitPolicy, PassError> {
    // `??`: a written null falls through to the convention.
    let written = tree_nodes_member(named.settings, "overLimit")
        .filter(|value| !matches!(value, JsonValue::Null));
    let written = match written {
        Some(value) => Some(value),
        None => scope
            .context
            .conventions
            .get("paging.overLimit")?
            .map(|reading| reading.value),
    };
    let Some(JsonValue::String(text)) = written else {
        return Ok(DEFAULT_OVER_LIMIT);
    };

    Ok(OVER_LIMITS
        .iter()
        .find(|policy| policy.as_str() == text)
        .cloned()
        .unwrap_or(DEFAULT_OVER_LIMIT))
}

fn refuse_sort_without_role(
    site: &TreeNodesSite<'_, '_>,
    sort_keys: &[SortKey],
    what: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if sort_keys.is_empty() {
        return Ok(());
    }

    let origin = scope
        .context
        .origin(&format!("{}/sortable", site.node.pointer))
        .unwrap_or_else(|| site.node.origin.clone());

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PagingSort,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The list {} declares sort keys, but {what} has no sort role to send them.",
                site.operation_id
            ),
            fix: "Remove sortable, or use a paging style with a sort role.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

fn sort_keys_of(
    site: &TreeNodesSite<'_, '_>,
    item: Option<&TypeUse>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<SortKey>, PassError> {
    let Some(JsonValue::Array(written)) = site.node.settings.get("sortable") else {
        return Ok(Vec::new());
    };
    let draft = scope.draft;
    let schema = tree_nodes_object_of(draft, item);
    let mut sort_keys = Vec::with_capacity(written.len());

    for (index, entry) in written.iter().enumerate() {
        let key = match entry {
            JsonValue::String(key) => Some(key),
            other => match tree_nodes_member(Some(other), "key") {
                Some(JsonValue::String(key)) => Some(key),
                _ => None,
            },
        };
        let pointer = format!("{}/sortable/{index}", site.node.pointer);
        let origin = scope.context.origin(&pointer);
        let (Some(key), Some(origin)) = (key, origin) else {
            return Err(InternalError::new(format!(
                "the sort key at {pointer} has no key or origin"
            ))
            .into());
        };

        if let Some(schema) = schema
            && !schema
                .properties
                .iter()
                .any(|property| property.name == *key)
        {
            report_unknown_key(site, key, schema.id.as_str(), &origin, scope)?;
        }

        sort_keys.push(SortKey {
            key: key.clone(),
            origin: Some(origin),
            right: None,
            params: None,
            subject: None,
            derived_from: None,
        });
    }

    Ok(sort_keys)
}

fn number_of(value: &JsonValue) -> Result<Option<i64>, PassError> {
    let JsonValue::Number(number) = value else {
        return Ok(None);
    };

    js_integer_in_range(number, MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER)
        .map(Some)
        .map_err(|error| {
            InternalError::new(format!("a paging limit is no integer: {error}")).into()
        })
}

fn sort_style_of(style: &JsonValue) -> Option<PagingParamStyle> {
    let request = tree_nodes_member(Some(style), "request");
    let role = tree_nodes_member(request, SORT_ROLE);
    let written =
        tree_nodes_member(role, "style").filter(|value| !matches!(value, JsonValue::Null));

    match written {
        None => Some(TREE_NODES_DEFAULT_SORT_STYLE),
        Some(JsonValue::String(text)) => PagingParamStyle::known(text),
        Some(_) => None,
    }
}

fn request_roles(style: &JsonValue) -> Vec<String> {
    match tree_nodes_member(Some(style), "request") {
        Some(JsonValue::Object(request)) => js_key_order(request.iter())
            .map(|(role, _)| role.clone())
            .collect(),
        _ => Vec::new(),
    }
}

fn written_limits(_settings: Option<&JsonValue>) -> Result<RouteLimits, PassError> {
    Err(not_ported_yet("writtenLimits"))
}

fn convention_limit(
    _value: Option<&JsonValue>,
    _origin: Option<&Origin>,
) -> Result<Option<ConventionLimit>, PassError> {
    Err(not_ported_yet("conventionLimit"))
}

fn above_max_limit(
    _default_limit: Option<i64>,
    _max_limit: Option<i64>,
) -> Result<Option<LimitPair>, PassError> {
    Err(not_ported_yet("aboveMaxLimit"))
}

fn convention_limits(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<ConventionLimits, PassError> {
    Err(not_ported_yet("conventionLimits"))
}

fn declared_style<'run>(
    _site: &TreeNodesSite<'_, '_>,
    _id: &str,
    _origin: &Origin,
    _scope: &TreeNodesScope<'_, '_, 'run>,
) -> Result<Option<&'run JsonValue>, PassError> {
    Err(not_ported_yet("declaredStyle"))
}

fn token_of(
    _site: &TreeNodesSite<'_, '_>,
    _named: &NamedStyle<'_>,
    _roles: &[String],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<PagingToken>, PassError> {
    Err(not_ported_yet("tokenOf"))
}

fn refuse_taken_names(
    _site: &TreeNodesSite<'_, '_>,
    _id: &str,
    _style: &JsonValue,
    _query: &[Param],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseTakenNames"))
}

fn limits_of(
    _site: &TreeNodesSite<'_, '_>,
    _named: &NamedStyle<'_>,
    _roles: &[String],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Limits>, PassError> {
    Err(not_ported_yet("limitsOf"))
}

fn refuse_unsignable_keys(
    _site: &TreeNodesSite<'_, '_>,
    _style_id: &str,
    _sort_keys: &[SortKey],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseUnsignableKeys"))
}

fn report_unknown_key(
    _site: &TreeNodesSite<'_, '_>,
    _key: &str,
    _schema: &str,
    _origin: &Origin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportUnknownKey"))
}

fn request_related(
    _site: &TreeNodesSite<'_, '_>,
    _id: &str,
    _role: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<RelatedLocation>, PassError> {
    Err(not_ported_yet("requestRelated"))
}

fn report_route_contradiction(
    _site: &TreeNodesSite<'_, '_>,
    _named: &NamedStyle<'_>,
    _pair: &LimitPair,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRouteContradiction"))
}

fn report_missing_limit(
    _site: &TreeNodesSite<'_, '_>,
    _named: &NamedStyle<'_>,
    _why: &str,
    _fix: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportMissingLimit"))
}

fn report_convention_contradiction(
    _site: &TreeNodesSite<'_, '_>,
    _default_limit: &ConventionLimit,
    _max_limit: &ConventionLimit,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportConventionContradiction"))
}
