//! Derived parameters and response headers (ADR 0004 section 7): appended after the declared ones,
//! in the order the writers run, which is the derivation table's, then source order. A name already
//! taken in the same list by the same derivation with the same type and requirement merges into
//! that element, its `from` extended; one taken by a declared element or another derivation, or by
//! the same derivation with another type or requirement, is a compile error, since a target could
//! not tell the two apart. Header names compare case-insensitively (RFC 9110 section 5.1), query
//! names exactly.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivedFrom, Origin, Param, QueryStyle, QueryWire, QueryWireKind, Refinements, Response,
    ResponseHeader, ResponseHeaderSemantic, ScalarType, ScalarTypeUse, TypeUse,
};
use seampact_pipeline::{OperationIndex, PassError};

use crate::not_ported::not_ported_yet;
use crate::report::DeriveWireRelated;
use crate::routes::{DeriveWireRoute, DeriveWireScope};

/// The response header of web links (RFC 8288): the paging links and the deprecation successor
/// share it.
pub(crate) const DERIVE_WIRE_LINK: &str = "Link";

const SUCCESS_FIRST: i64 = 200;
const SUCCESS_LAST: i64 = 299;

/// Refinements that refine nothing.
pub(crate) const fn derive_wire_no_refinements() -> Refinements {
    Refinements {
        min_length: None,
        max_length: None,
        pattern: None,
        minimum: None,
        maximum: None,
        exclusive_minimum: None,
        exclusive_maximum: None,
        multiple_of: None,
    }
}

/// A scalar type use that sets nothing but its type, its format and its refinements.
pub(crate) const fn derive_wire_scalar_use(
    scalar_type: ScalarType,
    format: Option<String>,
    refinements: Refinements,
) -> ScalarTypeUse {
    ScalarTypeUse {
        r#type: scalar_type,
        format,
        scalar: None,
        refinements,
        content: None,
        sensitive: None,
        nullable: None,
        docs: None,
        examples: None,
    }
}

/// The string type use of a header or query value that declares no schema.
pub(crate) const fn derive_wire_string_use() -> TypeUse {
    TypeUse::Scalar(derive_wire_scalar_use(
        ScalarType::String,
        None,
        derive_wire_no_refinements(),
    ))
}

/// The query wire of a single text value: `name=value`, as a query credential travels.
pub(crate) const fn derive_wire_text_query_wire() -> QueryWire {
    QueryWire {
        kind: QueryWireKind::Text,
        style: QueryStyle::Form,
        explode: true,
        brackets: false,
    }
}

/// Where a derived request parameter goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveWireParamPlace {
    Header,
    Query,
}

impl DeriveWireParamPlace {
    /// The place as the messages write it.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Header => "header",
            Self::Query => "query",
        }
    }
}

/// A derived element to write: its name, type, whether it is required, and its derivation record.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireDerived {
    pub(crate) name: String,
    pub(crate) r#type: TypeUse,
    pub(crate) required: bool,
    pub(crate) derived_from: DerivedFrom,
    /// The query wire of a query parameter; a single text value when absent.
    pub(crate) wire: Option<QueryWire>,
}

/// An element already in a list, a request parameter or a response header alike.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireNamed {
    pub(crate) name: String,
    pub(crate) r#type: TypeUse,
    pub(crate) required: bool,
    pub(crate) origin: Option<Origin>,
    pub(crate) derived_from: Option<DerivedFrom>,
    pub(crate) semantic: Option<ResponseHeaderSemantic>,
}

/// The list a derived element is added to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveWireElementList {
    Params(DeriveWireParamPlace),
    /// The headers of the response at this position of the operation's responses.
    ResponseHeaders {
        response: usize,
    },
}

impl DeriveWireElementList {
    const fn place(self) -> DeriveWireParamPlace {
        match self {
            Self::Params(place) => place,
            Self::ResponseHeaders { .. } => DeriveWireParamPlace::Header,
        }
    }
}

/// A collision of a derived name with an element already in the list.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireCollision<'derived, 'route> {
    pub(crate) place: DeriveWireParamPlace,
    pub(crate) existing: DeriveWireNamed,
    pub(crate) derived: &'derived DeriveWireDerived,
    pub(crate) route: &'route DeriveWireRoute,
    pub(crate) message: String,
    pub(crate) fix: String,
}

// An element of a list, borrowed from the draft or from what the half accumulated.
struct NamedRef<'list> {
    name: &'list str,
    r#type: &'list TypeUse,
    required: bool,
    origin: Option<&'list Origin>,
    derived_from: Option<&'list DerivedFrom>,
    semantic: Option<&'list ResponseHeaderSemantic>,
}

impl<'list> From<&'list Param> for NamedRef<'list> {
    fn from(param: &'list Param) -> Self {
        Self {
            name: &param.name,
            r#type: &param.r#type,
            required: param.required,
            origin: param.origin.as_ref(),
            derived_from: param.derived_from.as_ref(),
            semantic: None,
        }
    }
}

impl<'list> From<&'list ResponseHeader> for NamedRef<'list> {
    fn from(header: &'list ResponseHeader) -> Self {
        Self {
            name: &header.name,
            r#type: &header.r#type,
            required: header.required,
            origin: header.origin.as_ref(),
            derived_from: header.derived_from.as_ref(),
            semantic: header.semantic.as_ref(),
        }
    }
}

impl From<&NamedRef<'_>> for DeriveWireNamed {
    fn from(element: &NamedRef<'_>) -> Self {
        Self {
            name: element.name.to_owned(),
            r#type: element.r#type.clone(),
            required: element.required,
            origin: element.origin.cloned(),
            derived_from: element.derived_from.cloned(),
            semantic: element.semantic.cloned(),
        }
    }
}

fn same_name(place: DeriveWireParamPlace, left: &str, right: &str) -> bool {
    match place {
        DeriveWireParamPlace::Query => left == right,
        DeriveWireParamPlace::Header => left.to_lowercase() == right.to_lowercase(),
    }
}

// The elements of a list as the half has them so far, and how many of them the draft holds: the
// draft's first, then the half's own.
fn elements_of<'list>(
    scope: &'list DeriveWireScope<'_, '_, '_>,
    operation: OperationIndex,
    list: DeriveWireElementList,
) -> Result<(Vec<NamedRef<'list>>, usize), InternalError> {
    let draft_operation = scope.operation_of(operation)?;
    let written = scope
        .output
        .operations
        .get(operation.position())
        .ok_or_else(|| {
            InternalError::new(format!(
                "derive.wire read operation {}, which its output lacks",
                operation.position()
            ))
        })?;

    match list {
        DeriveWireElementList::Params(place) => {
            let (draft, added) = match (&draft_operation.params, place) {
                (Some(params), DeriveWireParamPlace::Query) => {
                    (&params.query, &written.query_params)
                }
                (Some(params), DeriveWireParamPlace::Header) => {
                    (&params.header, &written.header_params)
                }
                (None, _) => {
                    return Err(InternalError::new(
                        "derive.wire read the params of an operation that has none".to_owned(),
                    ));
                }
            };
            let draft_count = draft.len();

            Ok((
                draft.iter().chain(added).map(NamedRef::from).collect(),
                draft_count,
            ))
        }
        DeriveWireElementList::ResponseHeaders { response } => {
            let draft_responses = draft_operation.responses.as_deref().unwrap_or_default();
            let mut elements: Vec<NamedRef<'list>> = Vec::new();

            if let Some(draft_response) = draft_responses.get(response) {
                elements.extend(draft_response.headers.iter().map(NamedRef::from));
            } else {
                let appended = response.saturating_sub(draft_responses.len());

                if let Some(appended_response) = written.responses.get(appended) {
                    elements.extend(appended_response.headers.iter().map(NamedRef::from));
                }
            }

            let draft_count = elements.len();

            for addition in written
                .response_headers
                .iter()
                .filter(|item| item.response == response)
            {
                elements.extend(addition.headers.iter().map(NamedRef::from));
            }

            Ok((elements, draft_count))
        }
    }
}

// The derivation record of an element the half wrote, at `position` of the list's elements.
fn accumulated_derived_from<'scope>(
    scope: &'scope mut DeriveWireScope<'_, '_, '_>,
    operation: OperationIndex,
    list: DeriveWireElementList,
    position: usize,
    draft_count: usize,
) -> Result<&'scope mut DerivedFrom, InternalError> {
    let draft_responses = scope
        .operation_of(operation)?
        .responses
        .as_deref()
        .map_or(0, <[Response]>::len);
    let written = scope.output_of(operation)?;
    let added = position.saturating_sub(draft_count);
    let found = match list {
        DeriveWireElementList::Params(DeriveWireParamPlace::Query) => written
            .query_params
            .get_mut(added)
            .and_then(|param| param.derived_from.as_mut()),
        DeriveWireElementList::Params(DeriveWireParamPlace::Header) => written
            .header_params
            .get_mut(added)
            .and_then(|param| param.derived_from.as_mut()),
        DeriveWireElementList::ResponseHeaders { response } if response < draft_responses => {
            let mut headers = written
                .response_headers
                .iter_mut()
                .filter(|item| item.response == response)
                .flat_map(|item| item.headers.iter_mut());

            headers
                .nth(added)
                .and_then(|header| header.derived_from.as_mut())
        }
        DeriveWireElementList::ResponseHeaders { response } => {
            let own = response - draft_responses;
            let own_count = written
                .responses
                .get(own)
                .map_or(0, |item| item.headers.len());

            if added < own_count {
                written
                    .responses
                    .get_mut(own)
                    .and_then(|item| item.headers.get_mut(added))
                    .and_then(|header| header.derived_from.as_mut())
            } else {
                let mut headers = written
                    .response_headers
                    .iter_mut()
                    .filter(|item| item.response == response)
                    .flat_map(|item| item.headers.iter_mut());

                headers
                    .nth(added - own_count)
                    .and_then(|header| header.derived_from.as_mut())
            }
        }
    };

    found.ok_or_else(|| {
        InternalError::new(format!(
            "derive.wire merged into an element at {position} that its output lacks"
        ))
    })
}

/// Appends a derived request parameter to the operation's `place` list.
///
/// # Errors
///
/// An internal error for an operation without params; [`PassError::NotPortedYet`] when the name
/// is already taken.
pub(crate) fn derive_wire_add_param(
    route: &DeriveWireRoute,
    place: DeriveWireParamPlace,
    derived: DeriveWireDerived,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if scope.operation_of(route.operation)?.params.is_none() {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no params on operation '{}'",
            route.id
        ))
        .into());
    }

    if merged_into(
        DeriveWireElementList::Params(place),
        &derived,
        None,
        route,
        scope,
    )? {
        return Ok(());
    }

    let wire = match place {
        DeriveWireParamPlace::Query => {
            Some(derived.wire.unwrap_or_else(derive_wire_text_query_wire))
        }
        DeriveWireParamPlace::Header => None,
    };
    let param = Param {
        name: derived.name,
        r#type: derived.r#type,
        required: derived.required,
        wire,
        default: None,
        origin: None,
        derived_from: Some(derived.derived_from),
    };
    let written = scope.output_of(route.operation)?;

    match place {
        DeriveWireParamPlace::Query => written.query_params.push(param),
        DeriveWireParamPlace::Header => written.header_params.push(param),
    }

    Ok(())
}

/// Appends a derived response header to every success response (2xx) of the operation.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub(crate) fn derive_wire_add_success_header(
    _route: &DeriveWireRoute,
    _derived: &DeriveWireDerived,
    _semantic: Option<&ResponseHeaderSemantic>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("deriveWireAddSuccessHeader"))
}

/// Appends a derived header to one response of the operation, at its position.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub(crate) fn derive_wire_add_response_header(
    _route: &DeriveWireRoute,
    _response: usize,
    _derived: &DeriveWireDerived,
    _semantic: Option<&ResponseHeaderSemantic>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("deriveWireAddResponseHeader"))
}

/// The positions of the success responses of the operation tree.nodes wrote, 2xx only: a redirect
/// or a 304 is no success.
///
/// # Errors
///
/// An internal error for an operation without responses.
pub(crate) fn derive_wire_success_responses(
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Vec<usize>, InternalError> {
    if scope.operation_of(route.operation)?.responses.is_none() {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no responses on operation '{}'",
            route.id
        )));
    }

    let responses = scope.responses_of(route.operation)?;

    Ok(responses
        .iter()
        .enumerate()
        .filter(|(_, response)| (SUCCESS_FIRST..=SUCCESS_LAST).contains(&response.status))
        .map(|(position, _)| position)
        .collect())
}

// The element of the list that takes `name`, with its position and the draft's share of the list.
fn find_named(
    scope: &DeriveWireScope<'_, '_, '_>,
    operation: OperationIndex,
    list: DeriveWireElementList,
    name: &str,
) -> Result<(Option<(usize, DeriveWireNamed)>, usize), InternalError> {
    let (elements, draft_count) = elements_of(scope, operation, list)?;
    let found = elements
        .iter()
        .position(|element| same_name(list.place(), element.name, name))
        .and_then(|position| {
            elements
                .get(position)
                .map(|element| (position, DeriveWireNamed::from(element)))
        });

    Ok((found, draft_count))
}

// True when the name is already in the list: merged when the same derivation wrote it with the
// same semantic, type and requirement, else reported.
fn merged_into(
    list: DeriveWireElementList,
    derived: &DeriveWireDerived,
    semantic: Option<&ResponseHeaderSemantic>,
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    let place = list.place();
    let (found, draft_count) = find_named(scope, route.operation, list, &derived.name)?;
    let Some((position, existing)) = found else {
        return Ok(false);
    };
    let record = existing.derived_from.clone();
    let derivation = &derived.derived_from.derivation;

    let Some(record) = record.filter(|record| record.derivation == *derivation) else {
        let message = format!(
            "operation '{}' already has a {place} '{}' {}, so derivation {derivation} cannot add its own",
            route.id,
            existing.name,
            describe(&existing)?,
            place = place.as_str(),
        );

        report_collision(
            &DeriveWireCollision {
                place,
                existing,
                derived,
                route,
                message,
                fix: "Rename the declared parameter or header, or the name the derivation takes from its scheme, header or convention.".to_owned(),
            },
            scope,
        )?;

        return Ok(true);
    };

    if existing.semantic.as_ref() != semantic {
        let message = format!(
            "derivation {} writes the {place} '{}' of operation '{}' twice, as '{}' and as '{}'",
            record.derivation,
            derived.name,
            route.id,
            existing
                .semantic
                .as_ref()
                .map_or("plain", ResponseHeaderSemantic::as_str),
            semantic.map_or("plain", ResponseHeaderSemantic::as_str),
            place = place.as_str(),
        );

        report_collision(
            &DeriveWireCollision {
                place,
                existing,
                derived,
                route,
                message,
                fix: "Give each header the derivation writes its own name.".to_owned(),
            },
            scope,
        )?;

        return Ok(true);
    }

    if !same_shape(&existing, derived)? {
        let message = format!(
            "derivation {} writes the {place} '{}' of operation '{}' twice, with a different type or requirement",
            record.derivation,
            derived.name,
            route.id,
            place = place.as_str(),
        );

        report_collision(
            &DeriveWireCollision {
                place,
                existing,
                derived,
                route,
                message,
                fix: "Give each scheme or header declaration the derivation reads its own name, or make their type and requirement agree.".to_owned(),
            },
            scope,
        )?;

        return Ok(true);
    }

    let new_origins = new_origins_of(&record, derived)?;

    if new_origins.is_empty() {
        return Ok(true);
    }

    if position < draft_count {
        return Err(InternalError::new(format!(
            "derive.wire would extend the derivation of the {place} '{}' of operation '{}', which the draft holds",
            existing.name,
            route.id,
            place = place.as_str(),
        ))
        .into());
    }

    accumulated_derived_from(scope, route.operation, list, position, draft_count)?
        .from
        .extend(new_origins);

    Ok(true)
}

// The origins of the derived element the record does not name yet.
fn new_origins_of(
    record: &DerivedFrom,
    derived: &DeriveWireDerived,
) -> Result<Vec<Origin>, PassError> {
    let mut new_origins = Vec::new();

    for origin in &derived.derived_from.from {
        let mut known = false;

        for candidate in &record.from {
            if same_origin(candidate, origin)? {
                known = true;
                break;
            }
        }

        if !known {
            new_origins.push(origin.clone());
        }
    }

    Ok(new_origins)
}

fn describe(_element: &DeriveWireNamed) -> Result<String, PassError> {
    Err(not_ported_yet("describe"))
}

fn same_origin(_left: &Origin, _right: &Origin) -> Result<bool, PassError> {
    Err(not_ported_yet("sameOrigin"))
}

// Type uses are plain data written by the IR writers, so their JSON text compares them.
fn same_shape(
    _existing: &DeriveWireNamed,
    _derived: &DeriveWireDerived,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sameShape"))
}

// A route that declared the name taken wrote the fault, so it is located there. Otherwise both
// sides are derived and the fault is reported once, at the derivation's name origin.
fn report_collision(
    _collision: &DeriveWireCollision<'_, '_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportCollision"))
}

fn last_authored(_derived: &DeriveWireDerived) -> Result<Option<Origin>, PassError> {
    Err(not_ported_yet("lastAuthored"))
}

// The authored origins of both sides but the location, a core default having none.
fn related_of(
    _existing: &DeriveWireNamed,
    _derived: &DeriveWireDerived,
    _located: &str,
) -> Result<Vec<DeriveWireRelated>, PassError> {
    Err(not_ported_yet("relatedOf"))
}
