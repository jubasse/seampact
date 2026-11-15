//! The `paging` member of an operation: the style it uses, its limits and token, and the sort keys of its item.

use seampact_diagnostics::RelatedLocation;
use seampact_ir::{
    Origin, OverLimitPolicy, Paging, PagingId, PagingParamStyle, PagingToken, Param, Response, SortKey,
    TypeUse,
};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::responses::tree_nodes_is_list;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

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
            over_limit: over_limit_of(site, &named, scope)?,
            token: None,
            sort_keys,
            origin: named.origin.clone(),
        }));
    };
    let Some(style) = declared_style(site, named_id, &named.origin, scope)? else {
        return Ok(None);
    };
    let roles = request_roles(style)?;

    if !roles.iter().any(|role| role == SORT_ROLE) {
        refuse_sort_without_role(site, &sort_keys, &format!("the style {named_id}"), scope)?;
    } else if sort_style_of(style)? == Some(SIGNED_SORT_STYLE) {
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

fn named_style<'run>(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, 'run>,
) -> Result<Option<NamedStyle<'run>>, PassError> {
    Err(not_ported_yet("namedStyle"))
}

fn over_limit_of(
    _site: &TreeNodesSite<'_, '_>,
    _named: &NamedStyle<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<OverLimitPolicy, PassError> {
    Err(not_ported_yet("overLimitOf"))
}

fn refuse_sort_without_role(
    _site: &TreeNodesSite<'_, '_>,
    _sort_keys: &[SortKey],
    _what: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseSortWithoutRole"))
}

fn sort_keys_of(
    _site: &TreeNodesSite<'_, '_>,
    _item: Option<&TypeUse>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<SortKey>, PassError> {
    Err(not_ported_yet("sortKeysOf"))
}

fn number_of(_value: &JsonValue) -> Result<Option<i64>, PassError> {
    Err(not_ported_yet("numberOf"))
}

fn sort_style_of(_style: &JsonValue) -> Result<Option<PagingParamStyle>, PassError> {
    Err(not_ported_yet("sortStyleOf"))
}

fn request_roles(_style: &JsonValue) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("requestRoles"))
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
