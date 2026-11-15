//! Derived parameters and response headers (ADR 0004 section 7): appended after the declared ones,
//! in the order the writers run, which is the derivation table's, then source order. A name already
//! taken in the same list by the same derivation with the same type and requirement merges into
//! that element, its `from` extended; one taken by a declared element or another derivation, or by
//! the same derivation with another type or requirement, is a compile error, since a target could
//! not tell the two apart. Header names compare case-insensitively (RFC 9110 section 5.1), query
//! names exactly.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivedFrom, Layer, Origin, Param, QueryStyle, QueryWire, QueryWireKind, Refinements, Response,
    ResponseHeader, ResponseHeaderSemantic, ScalarType, ScalarTypeUse, TypeUse,
};
use seampact_pipeline::{MergedResponse, OperationIndex, merged_response_order};

use crate::report::{DeriveWireProblem, DeriveWireRelated, DeriveWireRule};
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

pub(crate) fn same_name(place: DeriveWireParamPlace, left: &str, right: &str) -> bool {
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
            let order = merged_response_order(draft_responses.len(), &written.responses)?;
            let own_headers = match order.get(response) {
                Some(MergedResponse::Draft(index)) => draft_responses
                    .get(*index)
                    .map(|draft_response| &draft_response.headers),
                Some(MergedResponse::Derived(index)) => written
                    .responses
                    .get(*index)
                    .map(|derived| &derived.response.headers),
                None => None,
            };
            let mut elements: Vec<NamedRef<'list>> = Vec::new();

            if let Some(headers) = own_headers {
                elements.extend(headers.iter().map(NamedRef::from));
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
    let order = merged_response_order(draft_responses, &written.responses)?;
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
        DeriveWireElementList::ResponseHeaders { response }
            if !matches!(order.get(response), Some(MergedResponse::Derived(_))) =>
        {
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
            let Some(MergedResponse::Derived(own)) = order.get(response).copied() else {
                return Err(InternalError::new(format!(
                    "derive.wire read response {response}, which it did not derive"
                )));
            };
            let own_count = written
                .responses
                .get(own)
                .map_or(0, |item| item.response.headers.len());

            if added < own_count {
                written
                    .responses
                    .get_mut(own)
                    .and_then(|item| item.response.headers.get_mut(added))
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
/// An internal error for an operation without params.
pub(crate) fn derive_wire_add_param(
    route: &DeriveWireRoute,
    place: DeriveWireParamPlace,
    derived: DeriveWireDerived,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    if scope.operation_of(route.operation)?.params.is_none() {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no params on operation '{}'",
            route.id
        )));
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
/// An internal error for an operation without responses.
pub(crate) fn derive_wire_add_success_header(
    route: &DeriveWireRoute,
    derived: &DeriveWireDerived,
    semantic: Option<&ResponseHeaderSemantic>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    for response in derive_wire_success_responses(route, scope)? {
        derive_wire_add_response_header(route, response, derived, semantic, scope)?;
    }

    Ok(())
}

/// Appends a derived header to one response of the operation, at its position.
///
/// # Errors
///
/// An internal error when the half read an element it did not write.
pub(crate) fn derive_wire_add_response_header(
    route: &DeriveWireRoute,
    response: usize,
    derived: &DeriveWireDerived,
    semantic: Option<&ResponseHeaderSemantic>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let list = DeriveWireElementList::ResponseHeaders { response };

    if merged_into(list, derived, semantic, route, scope)? {
        return Ok(());
    }

    let header = ResponseHeader {
        name: derived.name.clone(),
        r#type: derived.r#type.clone(),
        required: derived.required,
        semantic: semantic.cloned(),
        origin: None,
        derived_from: Some(derived.derived_from.clone()),
    };

    scope.add_response_header(route.operation, response, header)
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
) -> Result<bool, InternalError> {
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
            describe(&existing),
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

    if !same_shape(&existing, derived) {
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

    let new_origins = new_origins_of(&record, derived);

    if new_origins.is_empty() {
        return Ok(true);
    }

    if position < draft_count {
        return Err(InternalError::new(format!(
            "derive.wire would extend the derivation of the {place} '{}' of operation '{}', which the draft holds",
            existing.name,
            route.id,
            place = place.as_str(),
        )));
    }

    accumulated_derived_from(scope, route.operation, list, position, draft_count)?
        .from
        .extend(new_origins);

    Ok(true)
}

// The origins of the derived element the record does not name yet, each once.
fn new_origins_of(record: &DerivedFrom, derived: &DeriveWireDerived) -> Vec<Origin> {
    let mut new_origins: Vec<Origin> = Vec::new();

    for origin in &derived.derived_from.from {
        let known = record
            .from
            .iter()
            .chain(&new_origins)
            .any(|candidate| same_origin(candidate, origin));

        if !known {
            new_origins.push(origin.clone());
        }
    }

    new_origins
}

fn describe(element: &DeriveWireNamed) -> String {
    match &element.derived_from {
        None => "declared on the route".to_owned(),
        Some(record) => format!("from derivation {}", record.derivation),
    }
}

fn same_origin(left: &Origin, right: &Origin) -> bool {
    left.layer == right.layer && left.pointer == right.pointer
}

// Type uses are plain data written by the IR writers, so equal values have equal JSON text.
fn same_shape(existing: &DeriveWireNamed, derived: &DeriveWireDerived) -> bool {
    existing.required == derived.required && existing.r#type == derived.r#type
}

// A route that declared the name taken wrote the fault, so it is located there. Otherwise both
// sides are derived and the fault is reported once, at the derivation's name origin.
fn report_collision(
    collision: &DeriveWireCollision<'_, '_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let DeriveWireCollision {
        place,
        existing,
        derived,
        route,
        message,
        fix,
    } = collision;
    let route_pointer = &scope.node_of(route)?.pointer;
    let name_origin = existing
        .derived_from
        .as_ref()
        .and_then(|_| last_authored(derived));

    let Some(name_origin) = name_origin else {
        let related = related_of(existing, derived, route_pointer);

        return scope.reporter().error(DeriveWireProblem {
            rule: DeriveWireRule::DerivedNameCollision,
            message: message.clone(),
            fix: fix.clone(),
            pointer: route_pointer.clone(),
            related,
        });
    };

    let key = [
        derived.derived_from.derivation.as_str(),
        place.as_str(),
        derived.name.to_lowercase().as_str(),
        name_origin.pointer.as_str(),
    ]
    .join(" ");

    if !scope.reported_collisions.insert(key) {
        return Ok(());
    }

    let mut related = vec![DeriveWireRelated {
        pointer: route_pointer.clone(),
        message: "the first route it reaches".to_owned(),
    }];

    related.extend(related_of(existing, derived, &name_origin.pointer));

    scope.reporter().error(DeriveWireProblem {
        rule: DeriveWireRule::DerivedNameCollision,
        message: message.clone(),
        fix: fix.clone(),
        pointer: name_origin.pointer.clone(),
        related,
    })
}

// The name of a derived element comes from its last authored origin, which every route it reaches
// shares.
fn last_authored(derived: &DeriveWireDerived) -> Option<&Origin> {
    derived
        .derived_from
        .from
        .iter()
        .rfind(|origin| origin.layer != Layer::Core)
}

// The authored origins of both sides but the location, a core default having none.
fn related_of(
    existing: &DeriveWireNamed,
    derived: &DeriveWireDerived,
    located: &str,
) -> Vec<DeriveWireRelated> {
    let existing_origins: &[Origin] = match (&existing.origin, &existing.derived_from) {
        (Some(origin), _) => std::slice::from_ref(origin),
        (None, Some(record)) => &record.from,
        (None, None) => &[],
    };
    let sides = [
        (existing_origins, "the name taken"),
        (&derived.derived_from.from, "the derivation"),
    ];

    sides
        .into_iter()
        .flat_map(|(origins, message)| {
            origins
                .iter()
                .filter(|origin| origin.layer != Layer::Core && origin.pointer != located)
                .map(move |origin| DeriveWireRelated {
                    pointer: origin.pointer.clone(),
                    message: message.to_owned(),
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use seampact_ir::DerivationId;

    use super::*;

    fn origin(layer: Layer, pointer: &str) -> Origin {
        Origin {
            api: None,
            layer,
            pointer: pointer.to_owned(),
        }
    }

    fn derived_from(from: Vec<Origin>) -> DerivedFrom {
        DerivedFrom {
            derivation: DerivationId::from_static("test.derivation"),
            from,
        }
    }

    fn derived(from: Vec<Origin>) -> DeriveWireDerived {
        DeriveWireDerived {
            name: "X".to_owned(),
            r#type: derive_wire_string_use(),
            required: true,
            derived_from: derived_from(from),
            wire: None,
        }
    }

    #[test]
    fn an_origin_repeated_in_the_derived_element_is_added_once() {
        let known = origin(Layer::Api, "/a");
        let fresh = origin(Layer::Api, "/b");
        let record = derived_from(vec![known.clone()]);
        let element = derived(vec![known, fresh.clone(), fresh.clone()]);

        assert_eq!(new_origins_of(&record, &element), vec![fresh]);
    }

    #[test]
    fn the_name_origin_is_the_last_authored_one() {
        let element = derived(vec![
            origin(Layer::Api, "/first"),
            origin(Layer::Api, "/last"),
            origin(Layer::Core, "/core"),
        ]);

        assert_eq!(
            last_authored(&element).map(|found| found.pointer.as_str()),
            Some("/last")
        );
        assert_eq!(
            last_authored(&derived(vec![origin(Layer::Core, "/core")])),
            None
        );
    }

    #[test]
    fn related_locations_leave_out_the_core_and_the_located_pointer() {
        let existing = DeriveWireNamed {
            name: "X".to_owned(),
            r#type: derive_wire_string_use(),
            required: true,
            origin: None,
            derived_from: Some(derived_from(vec![
                origin(Layer::Api, "/taken"),
                origin(Layer::Core, "/core"),
                origin(Layer::Api, "/here"),
            ])),
            semantic: None,
        };
        let element = derived(vec![
            origin(Layer::Api, "/own"),
            origin(Layer::Api, "/here"),
        ]);
        let related = related_of(&existing, &element, "/here");

        assert_eq!(
            related,
            vec![
                DeriveWireRelated {
                    pointer: "/taken".to_owned(),
                    message: "the name taken".to_owned()
                },
                DeriveWireRelated {
                    pointer: "/own".to_owned(),
                    message: "the derivation".to_owned()
                },
            ]
        );
    }
}
