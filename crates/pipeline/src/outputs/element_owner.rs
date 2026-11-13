//! The element-owner rule of the `elements` lists, checked where a half's output merges.
//!
//! An element with no `derivedFrom` is declared and belongs to `tree.nodes`; one with
//! `derivedFrom` belongs to the half that owns its derivation in the derivation table. A half
//! that appends an element it does not own, or a derived element to a list its row does not let
//! its owner derive into, is an [`InternalError`].

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivedFrom, Param, Response, ResponseHeader};

use super::merge::Site;
use crate::{Half, derivation_row_of};

/// The half that owns the elements declared without `derivedFrom`.
const DECLARED_OWNER: Half = Half::TreeNodes;

/// A list several halves append to, with the halves whose derivations add elements to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ElementList {
    PathParams,
    QueryParams,
    HeaderParams,
    Responses,
    ResponseHeaders,
}

impl ElementList {
    fn field(self) -> &'static str {
        match self {
            Self::PathParams => "params.path",
            Self::QueryParams => "params.query",
            Self::HeaderParams => "params.header",
            Self::Responses => "responses",
            Self::ResponseHeaders => "responses[].headers",
        }
    }

    // `tree.nodes` copies a relay route's elements; access.rights adds rule proof headers;
    // derive.wire the other derived parameters, responses and response headers.
    fn derived_by(self) -> &'static [Half] {
        match self {
            Self::HeaderParams => &[Half::TreeNodes, Half::AccessRights, Half::DeriveWire],
            Self::PathParams | Self::QueryParams | Self::Responses | Self::ResponseHeaders => {
                &[Half::TreeNodes, Half::DeriveWire]
            }
        }
    }
}

/// The owner of one element, with the derivation that gives it.
struct ElementOwner<'derived> {
    owner: Option<Half>,
    derivation: Option<&'derived str>,
}

fn element_owner(derived_from: Option<&DerivedFrom>) -> ElementOwner<'_> {
    let Some(derived_from) = derived_from else {
        return ElementOwner {
            owner: Some(DECLARED_OWNER),
            derivation: None,
        };
    };
    let derivation = derived_from.derivation.as_str();

    ElementOwner {
        owner: derivation_row_of(derivation).and_then(|row| row.wire),
        derivation: Some(derivation),
    }
}

fn refuse_element(
    list: ElementList,
    derived_from: Option<&DerivedFrom>,
    site: &Site,
) -> Result<(), InternalError> {
    let ElementOwner { owner, derivation } = element_owner(derived_from);
    let field = site.describe(list.field());

    if let (Some(derivation), Some(owner)) = (derivation, owner)
        && !list.derived_by().contains(&owner)
    {
        let derived_by: Vec<&str> = list.derived_by().iter().map(|half| half.as_str()).collect();

        return Err(InternalError::new(format!(
            "{field}: derivation {derivation} adds no element here (derived by {})",
            derived_by.join(", ")
        )));
    }

    if owner == Some(site.half) {
        return Ok(());
    }

    let by = derivation.map_or_else(
        || "declared".to_owned(),
        |derivation| format!("derivation {derivation}"),
    );

    Err(InternalError::new(match owner {
        Some(owner) => format!("{field}: the element is owned by {owner} ({by})"),
        None => format!("{field}: the element has no owner ({by})"),
    }))
}

/// Refuses the first parameter of `list` that the half of `site` does not own.
pub(crate) fn check_params(
    list: ElementList,
    params: &[Param],
    site: &Site,
) -> Result<(), InternalError> {
    params
        .iter()
        .try_for_each(|param| refuse_element(list, param.derived_from.as_ref(), site))
}

/// Refuses the first response header that the half of `site` does not own.
pub(crate) fn check_response_headers(
    headers: &[ResponseHeader],
    site: &Site,
) -> Result<(), InternalError> {
    headers.iter().try_for_each(|header| {
        refuse_element(
            ElementList::ResponseHeaders,
            header.derived_from.as_ref(),
            site,
        )
    })
}

/// Refuses the first response, or header of a response, that the half of `site` does not own.
pub(crate) fn check_responses(responses: &[Response], site: &Site) -> Result<(), InternalError> {
    for response in responses {
        refuse_element(ElementList::Responses, response.derived_from.as_ref(), site)?;
        check_response_headers(&response.headers, site)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    type Outcome = Result<(), String>;

    fn origin() -> serde_json::Value {
        json!({"layer": "api", "pointer": "/x"})
    }

    fn param(derivation: Option<&str>) -> Result<Param, String> {
        let mut value = json!({
            "name": "p",
            "type": {"kind": "ref", "schema": "S"},
            "required": true,
            "origin": origin(),
        });

        if let (Some(derivation), Some(object)) = (derivation, value.as_object_mut()) {
            object.insert(
                "derivedFrom".to_owned(),
                json!({"derivation": derivation, "from": [origin()]}),
            );
        }

        serde_json::from_value(value).map_err(|failure| failure.to_string())
    }

    fn header(derivation: Option<&str>) -> Result<ResponseHeader, String> {
        let mut value =
            json!({"name": "H", "type": {"kind": "ref", "schema": "S"}, "required": false});

        if let (Some(derivation), Some(object)) = (derivation, value.as_object_mut()) {
            object.insert(
                "derivedFrom".to_owned(),
                json!({"derivation": derivation, "from": [origin()]}),
            );
        }

        serde_json::from_value(value).map_err(|failure| failure.to_string())
    }

    fn response(headers: Vec<ResponseHeader>) -> Result<Response, String> {
        let mut response: Response = serde_json::from_value(
            json!({"status": 200, "shape": "item", "headers": [], "origin": origin()}),
        )
        .map_err(|failure| failure.to_string())?;

        response.headers = headers;

        Ok(response)
    }

    fn site(half: Half) -> Site {
        Site::of_operation(half, "getTask".to_owned())
    }

    fn refusal(result: Result<(), InternalError>) -> Result<String, String> {
        match result {
            Ok(()) => Err("the element was accepted".to_owned()),
            Err(failure) => Ok(failure.what().to_owned()),
        }
    }

    #[test]
    fn a_declared_element_belongs_to_tree_nodes_only() -> Outcome {
        let declared = [param(None)?];

        check_params(ElementList::PathParams, &declared, &site(Half::TreeNodes))
            .map_err(|failure| failure.what().to_owned())?;

        let failure = refusal(check_params(
            ElementList::PathParams,
            &declared,
            &site(Half::DeriveWire),
        ))?;

        assert!(
            failure.contains("the element is owned by tree.nodes (declared)"),
            "{failure}"
        );

        Ok(())
    }

    #[test]
    fn a_derived_element_belongs_to_the_half_that_owns_its_derivation() -> Outcome {
        let relayed = [param(Some("relay.route"))?];
        let wired = [param(Some("idempotency.write"))?];

        check_params(ElementList::QueryParams, &relayed, &site(Half::TreeNodes))
            .map_err(|failure| failure.what().to_owned())?;
        check_params(ElementList::QueryParams, &wired, &site(Half::DeriveWire))
            .map_err(|failure| failure.what().to_owned())?;

        let failure = refusal(check_params(
            ElementList::QueryParams,
            &relayed,
            &site(Half::DeriveWire),
        ))?;

        assert!(
            failure.contains("owned by tree.nodes (derivation relay.route)"),
            "{failure}"
        );

        let failure = refusal(check_params(
            ElementList::QueryParams,
            &wired,
            &site(Half::TreeNodes),
        ))?;

        assert!(
            failure.contains("owned by derive.wire (derivation idempotency.write)"),
            "{failure}"
        );

        Ok(())
    }

    #[test]
    fn a_pack_entry_is_access_rights_and_only_in_a_list_that_row_lets_it_derive_into() -> Outcome {
        let pack = [param(Some("pack.house.audit"))?];

        check_params(ElementList::HeaderParams, &pack, &site(Half::AccessRights))
            .map_err(|failure| failure.what().to_owned())?;

        let failure = refusal(check_params(
            ElementList::PathParams,
            &pack,
            &site(Half::AccessRights),
        ))?;

        assert!(
            failure.contains(
                "derivation pack.house.audit adds no element here (derived by tree.nodes, derive.wire)"
            ),
            "{failure}"
        );

        Ok(())
    }

    #[test]
    fn a_derivation_that_adds_no_element_has_no_owner() -> Outcome {
        for derivation in ["body.media", "not.a.derivation", "pack.house"] {
            let failure = refusal(check_params(
                ElementList::HeaderParams,
                &[param(Some(derivation))?],
                &site(Half::DeriveWire),
            ))?;

            assert!(
                failure.contains(&format!(
                    "the element has no owner (derivation {derivation})"
                )),
                "{failure}"
            );
        }

        Ok(())
    }

    #[test]
    fn the_headers_of_a_response_are_elements_of_their_own_list() -> Outcome {
        let declared_response = [response(vec![header(Some("cache.etag"))?])?];

        let failure = refusal(check_responses(&declared_response, &site(Half::TreeNodes)))?;

        assert!(
            failure.contains("responses[].headers of operation getTask (tree.nodes)"),
            "{failure}"
        );
        assert!(
            failure.contains("owned by derive.wire (derivation cache.etag)"),
            "{failure}"
        );

        check_response_headers(&[header(Some("cache.etag"))?], &site(Half::DeriveWire))
            .map_err(|failure| failure.what().to_owned())
    }
}
