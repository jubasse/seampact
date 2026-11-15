//! The output of `derive.wire`.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ApiWire, Cache, DerivedFrom, Idempotency, OperationMaturity, Param, Response, ResponseHeader,
    UnknownKeys,
};

use super::element_owner::{ElementList, check_params, check_response_headers, check_responses};
use super::merge::{
    Site, existing, operations_with, write_once, write_once_if_some, write_unknown_keys,
};
use crate::{DraftIr, Half};

/// Headers `derive.wire` adds to one response.
///
/// `response` is the index in the operation's merged `responses`: the earlier halves' responses
/// with every response this half derives placed (`merged_response_order`).
#[derive(Debug, Clone, PartialEq)]
pub struct ResponseHeaderAdditions {
    /// The index of the response.
    pub response: usize,
    /// The headers appended to it.
    pub headers: Vec<ResponseHeader>,
}

/// Where a response `derive.wire` derives goes in the operation's `responses`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponsePosition {
    /// After every response, as `push` writes it.
    End,
    /// At this index of the responses as they stand when the response merges, as
    /// `splice(index, 0, response)` writes it: the earlier halves' responses and the responses
    /// this half derived before it.
    At(usize),
}

/// A response `derive.wire` derives, and where it goes.
#[derive(Debug, Clone, PartialEq)]
pub struct DerivedResponse {
    /// Where the response goes.
    pub position: ResponsePosition,
    /// The response.
    pub response: Response,
}

/// Where one response of the merged `responses` comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergedResponse {
    /// The response at this index of the draft's responses.
    Draft(usize),
    /// The response at this index of the half's derived responses.
    Derived(usize),
}

/// The origin of each response of the merged `responses`, in merged order: the draft's
/// `draft_count` responses with each derived response placed as its position says.
///
/// # Errors
///
/// An [`InternalError`] for a position past the responses it is placed among.
pub fn merged_response_order(
    draft_count: usize,
    derived: &[DerivedResponse],
) -> Result<Vec<MergedResponse>, InternalError> {
    let mut order: Vec<MergedResponse> = (0..draft_count).map(MergedResponse::Draft).collect();

    for (index, response) in derived.iter().enumerate() {
        let at = place_of(response.position, order.len())?;

        order.insert(at, MergedResponse::Derived(index));
    }

    Ok(order)
}

/// Places each derived response among `responses`, in order, as its position says.
///
/// # Errors
///
/// An [`InternalError`] for a position past the responses it is placed among.
pub fn place_derived_responses(
    responses: &mut Vec<Response>,
    derived: impl IntoIterator<Item = DerivedResponse>,
) -> Result<(), InternalError> {
    for DerivedResponse { position, response } in derived {
        let at = place_of(position, responses.len())?;

        responses.insert(at, response);
    }

    Ok(())
}

fn place_of(position: ResponsePosition, count: usize) -> Result<usize, InternalError> {
    match position {
        ResponsePosition::End => Ok(count),
        ResponsePosition::At(at) if at <= count => Ok(at),
        ResponsePosition::At(at) => Err(InternalError::new(format!(
            "derive.wire places a response at {at}, past the {count} responses"
        ))),
    }
}

/// What `derive.wire` writes on one operation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DeriveWireOperation {
    /// The derived path parameters, appended to `params.path`.
    pub path_params: Vec<Param>,
    /// The derived query parameters, appended to `params.query`.
    pub query_params: Vec<Param>,
    /// The derived header parameters, appended to `params.header`.
    pub header_params: Vec<Param>,
    /// The derived responses, placed in `responses` in order.
    pub responses: Vec<DerivedResponse>,
    /// The headers added to responses, of either kind.
    pub response_headers: Vec<ResponseHeaderAdditions>,
    /// The `input.bodyLimitBytes` member.
    pub body_limit_bytes: Option<i64>,
    /// The `idempotency` member.
    pub idempotency: Option<Idempotency>,
    /// The `concurrency.derivedFrom` member.
    pub concurrency_derived_from: Option<DerivedFrom>,
    /// The `cache` member.
    pub cache: Option<Cache>,
    /// The `deadlineHeader` member.
    pub deadline_header: Option<String>,
    /// The derived `maturity`, a default field written only where `tree.nodes` stated none.
    pub maturity: Option<OperationMaturity>,
    /// The `unknownKeys` of a body input that sets none, a default field.
    pub unknown_keys: Option<UnknownKeys>,
}

/// What `derive.wire` writes: the api-wide wire conventions and, per operation in draft order, the
/// derived members.
#[derive(Debug, Clone, PartialEq)]
pub struct DeriveWireOutput {
    /// The `api.wire` member, which no other half may write.
    pub api_wire: ApiWire,
    /// One entry per draft operation.
    pub operations: Vec<DeriveWireOperation>,
}

impl DeriveWireOutput {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &[
        "api.wire",
        "operations[].params.path",
        "operations[].params.query",
        "operations[].params.header",
        "operations[].responses",
        "operations[].responses[].headers",
        "operations[].input.bodyLimitBytes",
        "operations[].input.schema.unknownKeys",
        "operations[].idempotency",
        "operations[].concurrency.derivedFrom",
        "operations[].cache",
        "operations[].maturity",
        "operations[].deadlineHeader",
    ];

    /// Moves the output into the draft.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the member and the operation when the draft already holds a
    /// value there, when the api or a list has nothing to land on, when a response position or
    /// index is past the merged responses, or when the output has another number of
    /// operations than the draft.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::DeriveWire);
        let api = existing(&mut draft.api, "api", &site)?;

        write_once(&mut api.wire, self.api_wire, "api.wire", &site)?;

        for (operation, entry, site) in
            operations_with(&mut draft.operations, self.operations, Half::DeriveWire)?
        {
            merge_parameters(
                operation,
                entry.path_params,
                entry.query_params,
                entry.header_params,
                &site,
            )?;
            merge_responses(operation, entry.responses, entry.response_headers, &site)?;

            if let Some(limit) = entry.body_limit_bytes {
                let input = existing(&mut operation.input, "input", &site)?;

                write_once(
                    &mut input.body_limit_bytes,
                    limit,
                    "input.bodyLimitBytes",
                    &site,
                )?;
            }

            write_once_if_some(
                &mut operation.idempotency,
                entry.idempotency,
                "idempotency",
                &site,
            )?;

            if let Some(derived_from) = entry.concurrency_derived_from {
                let concurrency = existing(&mut operation.concurrency, "concurrency", &site)?;

                write_once(
                    &mut concurrency.derived_from,
                    derived_from,
                    "concurrency.derivedFrom",
                    &site,
                )?;
            }

            write_once_if_some(&mut operation.cache, entry.cache, "cache", &site)?;
            write_once_if_some(
                &mut operation.deadline_header,
                entry.deadline_header,
                "deadlineHeader",
                &site,
            )?;
            write_once_if_some(&mut operation.maturity, entry.maturity, "maturity", &site)?;
            write_unknown_keys(&mut operation.input, entry.unknown_keys, &site)?;
        }

        Ok(())
    }
}

fn merge_parameters(
    operation: &mut crate::DraftOperation,
    path_params: Vec<Param>,
    query_params: Vec<Param>,
    header_params: Vec<Param>,
    site: &Site,
) -> Result<(), InternalError> {
    if path_params.is_empty() && query_params.is_empty() && header_params.is_empty() {
        return Ok(());
    }

    check_params(ElementList::PathParams, &path_params, site)?;
    check_params(ElementList::QueryParams, &query_params, site)?;
    check_params(ElementList::HeaderParams, &header_params, site)?;

    let params = existing(&mut operation.params, "params", site)?;

    params.path.extend(path_params);
    params.query.extend(query_params);
    params.header.extend(header_params);

    Ok(())
}

fn merge_responses(
    operation: &mut crate::DraftOperation,
    derived: Vec<DerivedResponse>,
    header_additions: Vec<ResponseHeaderAdditions>,
    site: &Site,
) -> Result<(), InternalError> {
    if derived.is_empty() && header_additions.is_empty() {
        return Ok(());
    }

    for item in &derived {
        check_responses(std::slice::from_ref(&item.response), site)?;
    }

    let responses = existing(&mut operation.responses, "responses", site)?;

    place_derived_responses(responses, derived)?;

    for addition in header_additions {
        check_response_headers(&addition.headers, site)?;

        let total = responses.len();
        let response = responses.get_mut(addition.response).ok_or_else(|| {
            InternalError::new(format!(
                "{}: response index {} is past the {total} responses",
                site.describe("responses[].headers"),
                addition.response
            ))
        })?;

        response.headers.extend(addition.headers);
    }

    Ok(())
}
