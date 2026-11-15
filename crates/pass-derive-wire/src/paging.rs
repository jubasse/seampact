//! The request parameters and page headers of a paged list (`paging.params`, ADR 0002 section 14,
//! ADR 0006 section 5), from the style tree.nodes resolved and the limits it wrote. Every
//! parameter is optional. A cursor, `after`, `before` or opaque `since` is a string, an instant
//! `since` a `date-time`; a page counts from its `base`, an offset from 0, and a limit from 1 to
//! `maxLimit`, the bound written only with `overLimit: reject`. The sort parameter follows its
//! `style`: `signed`, `pair`, `keyed` or `split`; a pattern admits the `paging.sortKeys` only. The
//! style's response headers, and one `Link` header for its relations, go on the `page` response.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DecimalLiteral, DerivationId, DerivedFrom, OverLimitPolicy, Paging, PagingParamPlacement,
    PagingRequestRole, PagingRole, PagingStyle, PagingToken, QueryStyle, QueryWire, QueryWireKind,
    Refinements, ScalarType, ScalarTypeUse, TypeUse,
};
use seampact_pass_tree_schemas::tree_schemas_escape_pattern_literal;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param, derive_wire_no_refinements,
    derive_wire_scalar_use, derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope};

// A sort direction: `asc` or `desc` (grammar section 14); a signed key is descending with its `-`
// prefix.
const SORT_DIRECTIONS: [&str; 2] = ["asc", "desc"];

const DESCENDING_PREFIX: &str = "-";

const PAIR_SEPARATOR: &str = ",";

const PAGING: DerivationId = DerivationId::from_static("paging.params");

const KEY_PLACEHOLDER: &str = "{key}";

const DEFAULT_PAGE_BASE: i64 = 1;

const fn number_query_wire() -> QueryWire {
    QueryWire {
        kind: QueryWireKind::Number,
        style: QueryStyle::Form,
        explode: true,
        brackets: false,
    }
}

/// What the writers of one paged list share.
#[derive(Debug, Clone)]
struct Paged<'draft> {
    paging: &'draft Paging,
    style: &'draft PagingStyle,
    derived_from: DerivedFrom,
}

/// Writes the request parameters of the route's paging style and the headers of its page response.
///
/// # Errors
///
/// An internal error for a style the draft lacks, or [`PassError::NotPortedYet`] until the sort
/// and page-header writers are ported.
pub(crate) fn derive_wire_paging(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation = scope.operation_of(route.operation)?;
    let Some(paging) = &operation.paging else {
        return Ok(());
    };
    let Some(style_id) = &paging.style else {
        return Ok(());
    };
    let draft = scope.draft;
    let style = draft.pagings.get(style_id.as_str()).ok_or_else(|| {
        InternalError::new(format!(
            "tree.nodes wrote paging style '{style_id}' on '{}', which is no style",
            route.id
        ))
    })?;
    let paged = Paged {
        paging,
        style,
        derived_from: DerivedFrom {
            derivation: PAGING,
            from: vec![paging.origin.clone(), style.origin.clone()],
        },
    };

    for role in &style.request {
        write_role(route, role, &paged, scope)?;
    }

    write_page_headers(route, &paged, scope)
}

fn write_role(
    route: &DeriveWireRoute,
    role: &PagingRequestRole,
    paged: &Paged<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if role.role == PagingRole::Sort {
        return write_sort(route, role, paged, scope);
    }

    let place = if role.r#in == PagingParamPlacement::Query {
        DeriveWireParamPlace::Query
    } else {
        DeriveWireParamPlace::Header
    };
    let number = number_use(role, paged.paging, route)?;
    let wire = number.as_ref().map(|_| number_query_wire());
    let r#type = number.map_or_else(|| position_use(role, paged.paging), TypeUse::Scalar);

    derive_wire_add_param(
        route,
        place,
        DeriveWireDerived {
            wire,
            ..optional(&role.name, r#type, paged)
        },
        scope,
    )
}

// The integer roles with their bounds; `None` for a text role.
fn number_use(
    role: &PagingRequestRole,
    paging: &Paging,
    route: &DeriveWireRoute,
) -> Result<Option<ScalarTypeUse>, InternalError> {
    match role.role {
        PagingRole::Page => Ok(Some(integer_use(
            role.base.unwrap_or(DEFAULT_PAGE_BASE),
            None,
        ))),
        PagingRole::Offset => Ok(Some(integer_use(0, None))),
        PagingRole::Limit => limit_use(paging, route).map(Some),
        _ => Ok(None),
    }
}

fn limit_use(paging: &Paging, route: &DeriveWireRoute) -> Result<ScalarTypeUse, InternalError> {
    let Some(max_limit) = paging.max_limit else {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no maxLimit on the paged list '{}', whose style has a limit",
            route.id
        )));
    };
    let maximum = (paging.over_limit == OverLimitPolicy::Reject).then_some(max_limit);

    Ok(integer_use(1, maximum))
}

fn position_use(role: &PagingRequestRole, paging: &Paging) -> TypeUse {
    if role.role == PagingRole::Since && paging.token == Some(PagingToken::Instant) {
        return TypeUse::Scalar(derive_wire_scalar_use(
            ScalarType::String,
            Some("date-time".to_owned()),
            derive_wire_no_refinements(),
        ));
    }

    derive_wire_string_use()
}

// The bounds are safe integers, whose `to_string` is `String(n)` of the number.
pub(crate) fn integer_use(minimum: i64, maximum: Option<i64>) -> ScalarTypeUse {
    derive_wire_scalar_use(
        ScalarType::Integer,
        None,
        Refinements {
            minimum: Some(DecimalLiteral::new(minimum.to_string())),
            maximum: maximum.map(|bound| DecimalLiteral::new(bound.to_string())),
            ..derive_wire_no_refinements()
        },
    )
}

// No sort parameter on a list that sorts by nothing.
fn write_sort(
    _route: &DeriveWireRoute,
    _role: &PagingRequestRole,
    _paged: &Paged<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeSort"))
}

// The sort values a style accepts, each a string of exactly the declared keys (ADR 0003 section 9
// pattern): a signed item is a key or its descending form, a pair item a key and a direction, a
// split key one key.
fn signed_sort_use(_keys: &[&str]) -> Result<ScalarTypeUse, PassError> {
    Err(not_ported_yet("signedSortUse"))
}

fn pair_sort_use(_keys: &[&str]) -> Result<ScalarTypeUse, PassError> {
    Err(not_ported_yet("pairSortUse"))
}

fn sort_direction_use() -> Result<ScalarTypeUse, PassError> {
    one_of_use(&SORT_DIRECTIONS)
}

fn one_of_use(values: &[&str]) -> Result<ScalarTypeUse, PassError> {
    pattern_use(&format!("^{}$", alternation(values)))
}

fn alternation(values: &[&str]) -> String {
    let escaped: Vec<String> = values
        .iter()
        .map(|value| tree_schemas_escape_pattern_literal(value))
        .collect();

    format!("(?:{})", escaped.join("|"))
}

fn pattern_use(_source: &str) -> Result<ScalarTypeUse, PassError> {
    Err(not_ported_yet("patternUse"))
}

fn write_page_headers(
    _route: &DeriveWireRoute,
    _paged: &Paged<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writePageHeaders"))
}

fn optional(name: &str, r#type: TypeUse, paged: &Paged<'_>) -> DeriveWireDerived {
    DeriveWireDerived {
        name: name.to_owned(),
        r#type,
        required: false,
        derived_from: paged.derived_from.clone(),
        wire: None,
    }
}
