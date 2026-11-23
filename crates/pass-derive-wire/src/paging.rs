//! The request parameters and page headers of a paged list (`paging.params`, ADR 0002 section 14,
//! ADR 0006 section 5), from the style tree.nodes resolved and the limits it wrote. Every
//! parameter is optional. A cursor, `after`, `before` or opaque `since` is a string, an instant
//! `since` a `date-time`; a page counts from its `base`, an offset from 0, and a limit from 1 to
//! `maxLimit`, the bound written only with `overLimit: reject`. The sort parameter follows its
//! `style`: `signed`, `pair`, `keyed` or `split`; a pattern admits the `paging.sortKeys` only. The
//! style's response headers, and one `Link` header for its relations, go on the `page` response.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, DecimalLiteral, DerivedFrom, OverLimitPolicy, Paging, PagingParamPlacement,
    PagingParamStyle, PagingRequestRole, PagingRole, PagingStyle, PagingToken, Pattern, QueryStyle,
    QueryWire, QueryWireKind, Refinements, ResponseShape, ScalarType, ScalarTypeUse, TypeUse,
    derivation_ids,
};
use seampact_pass_tree_schemas::{
    TreeSchemasPatternResult, tree_schemas_escape_pattern_literal, tree_schemas_normalize_pattern,
};
use seampact_pipeline::PassError;

use crate::params::{
    DERIVE_WIRE_LINK, DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param,
    derive_wire_add_response_header, derive_wire_no_refinements, derive_wire_scalar_use,
    derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope};

// A sort direction: `asc` or `desc` (grammar section 14); a signed key is descending with its `-`
// prefix.
const SORT_DIRECTIONS: [&str; 2] = ["asc", "desc"];

const DESCENDING_PREFIX: &str = "-";

const PAIR_SEPARATOR: &str = ",";

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
/// An internal error for a style the draft lacks, or a derived sort pattern the pattern parser
/// refuses.
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
            derivation: derivation_ids::PAGING_PARAMS,
            from: vec![paging.origin.clone(), style.origin.clone()],
        },
    };

    for role in &style.request {
        write_role(route, role, &paged, scope)?;
    }

    write_page_headers(route, &paged, scope)?;

    Ok(())
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
    )?;

    Ok(())
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
    route: &DeriveWireRoute,
    role: &PagingRequestRole,
    paged: &Paged<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let keys: Vec<&str> = paged
        .paging
        .sort_keys
        .iter()
        .map(|sort_key| sort_key.key.as_str())
        .collect();

    if keys.is_empty() {
        return Ok(());
    }

    let place = if role.r#in == PagingParamPlacement::Query {
        DeriveWireParamPlace::Query
    } else {
        DeriveWireParamPlace::Header
    };
    let list = |items: ScalarTypeUse, explode: bool| DeriveWireDerived {
        wire: Some(QueryWire {
            kind: QueryWireKind::List,
            style: QueryStyle::Form,
            explode,
            brackets: false,
        }),
        ..optional(
            &role.name,
            TypeUse::Array(ArrayTypeUse {
                items: Box::new(TypeUse::Scalar(items)),
                min_items: None,
                max_items: None,
                nullable: None,
                docs: None,
                examples: None,
            }),
            paged,
        )
    };

    match role.style.clone().unwrap_or(PagingParamStyle::Signed) {
        PagingParamStyle::Signed => {
            let derived = list(signed_sort_use(&keys)?, false);

            derive_wire_add_param(route, place, derived, scope)?;
        }
        PagingParamStyle::Pair => {
            let derived = list(pair_sort_use(&keys)?, true);

            derive_wire_add_param(route, place, derived, scope)?;
        }
        PagingParamStyle::Keyed => {
            for key in keys {
                let name = keyed_name(&role.name, key);
                let derived = optional(&name, TypeUse::Scalar(sort_direction_use()?), paged);

                derive_wire_add_param(route, place, derived, scope)?;
            }
        }
        PagingParamStyle::Split => {
            let Some(direction) = &role.direction else {
                return Err(InternalError::new(format!(
                    "tree.nodes wrote a split sort role without its direction on '{}'",
                    route.id
                ))
                .into());
            };
            let key_use = TypeUse::Scalar(one_of_use(&keys)?);
            let direction_use = TypeUse::Scalar(sort_direction_use()?);

            derive_wire_add_param(route, place, optional(&role.name, key_use, paged), scope)?;
            derive_wire_add_param(
                route,
                place,
                optional(direction, direction_use, paged),
                scope,
            )?;
        }
        PagingParamStyle::Unknown(_) => {
            return Err(InternalError::new(
                "derive.wire reached a paging param style this IR revision does not know"
                    .to_owned(),
            )
            .into());
        }
    }

    Ok(())
}

// A name template with the key at its first placeholder only, as `String.replace` does.
fn keyed_name(template: &str, key: &str) -> String {
    template.replacen(KEY_PLACEHOLDER, key, 1)
}

// The sort values a style accepts, each a string of exactly the declared keys (ADR 0003 section 9
// pattern): a signed item is a key or its descending form, a pair item a key and a direction, a
// split key one key.
fn signed_sort_use(keys: &[&str]) -> Result<ScalarTypeUse, PassError> {
    let values: Vec<String> = keys
        .iter()
        .flat_map(|key| [(*key).to_owned(), format!("{DESCENDING_PREFIX}{key}")])
        .collect();

    one_of_use(&values)
}

fn pair_sort_use(keys: &[&str]) -> Result<ScalarTypeUse, PassError> {
    pattern_use(&format!(
        "^{}{PAIR_SEPARATOR}{}$",
        alternation(keys),
        alternation(&SORT_DIRECTIONS)
    ))
}

fn sort_direction_use() -> Result<ScalarTypeUse, PassError> {
    one_of_use(&SORT_DIRECTIONS)
}

fn one_of_use<Value: AsRef<str>>(values: &[Value]) -> Result<ScalarTypeUse, PassError> {
    pattern_use(&format!("^{}$", alternation(values)))
}

fn alternation<Value: AsRef<str>>(values: &[Value]) -> String {
    let escaped: Vec<String> = values
        .iter()
        .map(|value| tree_schemas_escape_pattern_literal(value.as_ref()))
        .collect();

    format!("(?:{})", escaped.join("|"))
}

fn pattern_use(source: &str) -> Result<ScalarTypeUse, PassError> {
    let normalized = match tree_schemas_normalize_pattern(source)? {
        TreeSchemasPatternResult::Normalized { normalized } => normalized,
        TreeSchemasPatternResult::Refused { message, .. } => {
            return Err(InternalError::new(format!(
                "the derived sort pattern '{source}' is refused: {message}"
            ))
            .into());
        }
    };

    Ok(derive_wire_scalar_use(
        ScalarType::String,
        None,
        Refinements {
            pattern: Some(Pattern {
                source: source.to_owned(),
                normalized,
            }),
            ..derive_wire_no_refinements()
        },
    ))
}

fn write_page_headers(
    route: &DeriveWireRoute,
    paged: &Paged<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let style_response = &paged.style.response;
    let mut names: Vec<&str> = style_response
        .headers
        .iter()
        .map(|header| header.name.as_str())
        .collect();

    if !style_response.links.is_empty() {
        names.push(DERIVE_WIRE_LINK);
    }

    if names.is_empty() {
        return Ok(());
    }

    let page_positions: Vec<usize> = scope
        .responses_of(route.operation)?
        .iter()
        .enumerate()
        .filter(|(_, response)| response.shape == ResponseShape::Page)
        .map(|(position, _)| position)
        .collect();

    if page_positions.is_empty() {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no page response on the paged list '{}'",
            route.id
        )));
    }

    for position in page_positions {
        for name in &names {
            let derived = optional(name, derive_wire_string_use(), paged);

            derive_wire_add_response_header(route, position, &derived, None, scope)?;
        }
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_keyed_name_takes_the_key_at_its_first_placeholder_only() {
        assert_eq!(
            keyed_name("order[{key}]{key}", "createdAt"),
            "order[createdAt]{key}"
        );
    }
}
