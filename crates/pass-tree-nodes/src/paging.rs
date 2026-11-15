//! The `paging` member of an operation: the style it uses, its limits and token, and the sort keys of its item.

use seampact_diagnostics::{InternalError, RelatedLocation};
use seampact_ir::{
    Origin, OverLimitPolicy, Paging, PagingId, PagingParamStyle, PagingToken, Param, Response,
    SortKey, TypeUse,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, js_integer_in_range};
use seampact_pass_tree_shared::{
    tree_nodes_member, tree_nodes_object_of, tree_nodes_written_convention,
};
use seampact_pipeline::{PassError, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
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

pub(crate) fn number_of(value: Option<&JsonValue>) -> Result<Option<i64>, PassError> {
    let Some(JsonValue::Number(number)) = value else {
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

fn written_limits(settings: Option<&JsonValue>) -> Result<RouteLimits, PassError> {
    let max_limit = number_of(tree_nodes_member(settings, "maxLimit"))?;
    let default_limit = number_of(tree_nodes_member(settings, "defaultLimit"))?;

    Ok(RouteLimits {
        max_limit,
        default_limit,
    })
}

fn convention_limit(
    value: Option<&JsonValue>,
    origin: Option<&Origin>,
) -> Result<Option<ConventionLimit>, PassError> {
    let (Some(value), Some(origin)) = (number_of(value)?, origin) else {
        return Ok(None);
    };

    Ok(Some(ConventionLimit {
        value,
        origin: origin.clone(),
    }))
}

fn above_max_limit(default_limit: Option<i64>, max_limit: Option<i64>) -> Option<LimitPair> {
    let (Some(default_limit), Some(max_limit)) = (default_limit, max_limit) else {
        return None;
    };

    (default_limit > max_limit).then_some(LimitPair {
        default_limit,
        max_limit,
    })
}

// `conventions.paging.defaultLimit` reads `maxLimit` when unwritten, so only a written one counts as a default.
fn convention_limits(scope: &TreeNodesScope<'_, '_, '_>) -> Result<ConventionLimits, PassError> {
    let conventions = scope.context.conventions;
    let max_reading = conventions.get("paging.maxLimit")?;
    let max_limit = convention_limit(
        max_reading.as_ref().map(|reading| reading.value),
        max_reading
            .as_ref()
            .and_then(|reading| reading.origin.as_ref()),
    )?;
    let written_default = tree_nodes_written_convention(*conventions, "paging.defaultLimit")?;
    let default_limit = convention_limit(
        written_default.as_ref().map(|written| written.value),
        written_default.as_ref().map(|written| &written.origin),
    )?;

    Ok(ConventionLimits {
        max_limit,
        default_limit,
    })
}

fn declared_style<'run>(
    site: &TreeNodesSite<'_, '_>,
    id: &str,
    origin: &Origin,
    scope: &mut TreeNodesScope<'_, '_, 'run>,
) -> Result<Option<&'run JsonValue>, PassError> {
    let raw = scope.context.raw;

    if let Some(style) = tree_nodes_member(raw.merged.get("pagings"), id) {
        return Ok(Some(style));
    }

    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::PagingUnknown,
        origin: tree_nodes_node_origin(origin)?,
        message: format!(
            "The paging style {id} of {} is not declared in pagings.",
            site.operation_id
        ),
        fix: format!("Declare {id} in pagings, or name a declared style."),
        related: Vec::new(),
    });

    tree_nodes_report_once(
        &format!("paging-unknown:{}#{}", origin.layer, origin.pointer),
        diagnostic,
        scope,
    );

    Ok(None)
}

// The id of a named style that sits in a message; only a style with an id reaches the checks that name it.
fn style_id_of<'named>(named: &'named NamedStyle<'_>) -> Result<&'named str, PassError> {
    named.id.as_deref().ok_or_else(|| {
        InternalError::new(format!(
            "the paging style at {} names no style id",
            named.origin.pointer
        ))
        .into()
    })
}

// `token` belongs to a style with a `since` role only.
fn token_of(
    site: &TreeNodesSite<'_, '_>,
    named: &NamedStyle<'_>,
    roles: &[String],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<PagingToken>, PassError> {
    let written = tree_nodes_member(named.settings, "token");
    let token = TOKENS
        .iter()
        .find(|candidate| matches!(written, Some(JsonValue::String(text)) if candidate.as_str() == text))
        .cloned();

    if roles.iter().any(|role| role == SINCE_ROLE) {
        return Ok(Some(token.unwrap_or(DEFAULT_TOKEN)));
    }

    if written.is_none() {
        return Ok(None);
    }

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PagingToken,
            origin: tree_nodes_node_origin(&named.origin)?,
            message: format!(
                "The list {} sets a token, but its style {} has no since role.",
                site.operation_id,
                style_id_of(named)?
            ),
            fix: "Remove token, or use a style with a since role.".to_owned(),
            related: Vec::new(),
        }));

    Ok(None)
}

// ADR 0002 section 14: a request name already used by the route's `query` is a compile error naming the style.
fn refuse_taken_names(
    site: &TreeNodesSite<'_, '_>,
    id: &str,
    style: &JsonValue,
    query: &[Param],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(JsonValue::Object(request)) = tree_nodes_member(Some(style), "request") else {
        return Ok(());
    };

    for (role, place) in js_key_order(request.iter()) {
        let Some(JsonValue::String(name)) = tree_nodes_member(Some(place), "query") else {
            continue;
        };
        let Some(taken) = query.iter().find(|param| param.name == *name) else {
            continue;
        };
        let origin = taken.origin.as_ref().unwrap_or(&site.node.origin);
        let related = request_related(id, role, scope)?;

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::PagingParam,
                origin: tree_nodes_node_origin(origin)?,
                message: format!(
                    "The query field {} of {} is also the {role} parameter of the paging style {id}.",
                    taken.name, site.operation_id
                ),
                fix: format!(
                    "Rename the query field {}, or use another paging style.",
                    taken.name
                ),
                related,
            }));
    }

    Ok(())
}

// ADR 0002 sections 13 and 14: `maxLimit` is required for a style with a `limit` role, `defaultLimit` is the
// limit of a request that sends none (the `maxLimit` by default) and the page size of a style without `limit`.
// Each limit comes from the route, else `conventions.paging`. A convention default above the route's `maxLimit` is
// lowered to it; a route default above the effective `maxLimit`, or a convention pair at odds, is refused.
fn limits_of(
    site: &TreeNodesSite<'_, '_>,
    named: &NamedStyle<'_>,
    roles: &[String],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Limits>, PassError> {
    let route = written_limits(named.settings)?;
    let conventions = convention_limits(scope)?;
    let max_limit = route
        .max_limit
        .or(conventions.max_limit.as_ref().map(|limit| limit.value));
    let written_default = route
        .default_limit
        .or(conventions.default_limit.as_ref().map(|limit| limit.value));
    let token = token_of(site, named, roles, scope)?;

    if roles.iter().any(|role| role == LIMIT_ROLE) && max_limit.is_none() {
        report_missing_limit(
            site,
            named,
            "its limit role needs a maxLimit",
            "Set maxLimit",
            scope,
        )?;

        return Ok(None);
    }

    let Some(inherited_default) = written_default.or(max_limit) else {
        report_missing_limit(
            site,
            named,
            "a style without a limit role needs a defaultLimit",
            "Set defaultLimit",
            scope,
        )?;

        return Ok(None);
    };

    if let Some(contradiction) = above_max_limit(route.default_limit, max_limit) {
        report_route_contradiction(site, named, &contradiction, scope)?;

        return Ok(None);
    }

    if let (Some(convention_default), Some(convention_max)) =
        (&conventions.default_limit, &conventions.max_limit)
        && above_max_limit(Some(convention_default.value), Some(convention_max.value)).is_some()
    {
        report_convention_contradiction(site, convention_default, convention_max, scope)?;

        return Ok(None);
    }

    let default_limit = max_limit.map_or(inherited_default, |max| inherited_default.min(max));

    Ok(Some(Limits {
        max_limit,
        default_limit: Some(default_limit),
        over_limit: over_limit_of(named, scope)?,
        token,
    }))
}

// A key holding the separator or starting with the descending sign could not be read back from a signed list.
fn refuse_unsignable_keys(
    site: &TreeNodesSite<'_, '_>,
    style_id: &str,
    sort_keys: &[SortKey],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    for SortKey { key, origin, .. } in sort_keys {
        if !key.contains(SIGNED_LIST_SEPARATOR) && !key.starts_with(SIGNED_DESCENDING_PREFIX) {
            continue;
        }

        let origin = origin.as_ref().unwrap_or(&site.node.origin);

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::SortKeySigned,
                origin: tree_nodes_node_origin(origin)?,
                message: format!(
                    "The sort key {key} of {} holds a ',' or starts with '-', which the signed sort style {style_id} cannot send.",
                    site.operation_id
                ),
                fix: format!(
                    "Rename {key}, or use a paging style whose sort role is pair, keyed or split."
                ),
                related: Vec::new(),
            }));
    }

    Ok(())
}

fn report_unknown_key(
    site: &TreeNodesSite<'_, '_>,
    key: &str,
    schema: &str,
    origin: &Origin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::SortKey,
            origin: tree_nodes_node_origin(origin)?,
            message: format!(
                "The sort key {key} of {} is not a property of its item {schema}.",
                site.operation_id
            ),
            fix: format!("Name a property of {schema}, or declare {key} on it."),
            related: Vec::new(),
        }));

    Ok(())
}

fn request_related(
    id: &str,
    role: &str,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<RelatedLocation>, PassError> {
    let pointer = pointer_below("/pagings", &[id, "request", role]);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Ok(Vec::new());
    };

    Ok(vec![RelatedLocation {
        origin: tree_nodes_node_origin(&origin)?,
        message: format!("the {role} role of {id}"),
    }])
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

#[cfg(test)]
mod tests {
    use seampact_ir::PagingParamStyle;
    use seampact_json::JsonValue;

    use super::{request_roles, sort_style_of};

    fn json(text: &str) -> JsonValue {
        serde_json::from_str(text).expect("test json")
    }

    #[test]
    fn request_roles_come_in_javascript_key_order() {
        let style = json(r#"{"request":{"sort":{},"10":{},"limit":{},"2":{}}}"#);

        assert_eq!(request_roles(&style), ["2", "10", "sort", "limit"]);
    }

    #[test]
    fn a_sort_style_falls_back_to_signed_on_absent_or_null() {
        for text in [r"{}", r#"{"request":{"sort":{"style":null}}}"#] {
            assert_eq!(
                sort_style_of(&json(text)),
                Some(PagingParamStyle::Signed),
                "style {text}"
            );
        }

        let pair = json(r#"{"request":{"sort":{"style":"pair"}}}"#);

        assert_eq!(sort_style_of(&pair), Some(PagingParamStyle::Pair));
    }
}
