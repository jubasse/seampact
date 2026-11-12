//! The output of `tree.nodes`.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Conventions, DeclarationKind, Degradable, Deprecation, Docs, Extensions, FormatId, HttpMethod,
    InputField, InputMediaType, IrMap, Lint, Name, OpShorthand, OperationExample, OperationId,
    OperationMaturity, OperationRef, OperationResource, Origin, OverLimitPolicy, Owner, PackRef,
    PagingId, PagingStyle, PagingToken, Params, Response, Service, ServiceId, SortKey, SurfaceId,
    TypeUse, UnknownQuery, ValueSource, WireFormat,
};

use super::merge::{Site, write_catalogue, write_list, write_once};
use crate::{
    ApiDeclaration, DraftApi, DraftConcurrency, DraftIr, DraftOperation, DraftOperationInput, Half,
};

/// The concurrency `tree.nodes` declares: `derivedFrom` is `derive.wire`'s.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesConcurrency {
    /// The `version` member.
    pub version: ValueSource,
    /// The `field` member.
    pub field: String,
}

/// The input `tree.nodes` declares: no `rawBody`, `bodyLimitBytes` or `proofs`.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesInput {
    /// The `media` member.
    pub media: InputMediaType,
    /// The `schema` member, with the `unknownKeys` it states.
    pub schema: TypeUse,
    /// The `fields` member of a form or multipart input.
    pub fields: Option<Vec<InputField>>,
    /// The `origin` member.
    pub origin: Origin,
}

/// A sort key without rights.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesSortKey {
    /// The `key` member.
    pub key: String,
    /// The `origin` member.
    pub origin: Option<Origin>,
}

/// The paging `tree.nodes` declares: sort keys without rights.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesPaging {
    /// The `style` member.
    pub style: Option<PagingId>,
    /// The `maxLimit` member.
    pub max_limit: Option<i64>,
    /// The `defaultLimit` member.
    pub default_limit: Option<i64>,
    /// The `overLimit` member.
    pub over_limit: OverLimitPolicy,
    /// The `token` member.
    pub token: Option<PagingToken>,
    /// The sort keys, each `key` and `origin` only.
    pub sort_keys: Vec<TreeNodesSortKey>,
    /// The `origin` member.
    pub origin: Origin,
}

/// An operation as `tree.nodes` creates it: the route and the shape it declares.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesOperation {
    /// The `kind` member.
    pub kind: DeclarationKind,
    /// The `id` member.
    pub id: OperationId,
    /// The `name` member.
    pub name: Name,
    /// The `surface` member.
    pub surface: SurfaceId,
    /// The `op` member.
    pub op: Option<OpShorthand>,
    /// The `resource` member.
    pub resource: Option<OperationResource>,
    /// The `method` member.
    pub method: HttpMethod,
    /// The `path` member.
    pub path: String,
    /// The `safe` member.
    pub safe: bool,
    /// The declared parameters, with the three lists always present.
    pub params: Params,
    /// The `unknownQuery` member.
    pub unknown_query: UnknownQuery,
    /// The declared `input`.
    pub input: Option<TreeNodesInput>,
    /// The declared responses, a list that is always present.
    pub responses: Vec<Response>,
    /// The declared `concurrency`.
    pub concurrency: Option<TreeNodesConcurrency>,
    /// The `owner` member.
    pub owner: Option<Owner>,
    /// The declared `paging`.
    pub paging: Option<TreeNodesPaging>,
    /// The `degradable` member.
    pub degradable: Option<Degradable>,
    /// The `budgetMs` member.
    pub budget_ms: Option<i64>,
    /// The `deprecated` member.
    pub deprecated: Option<Deprecation>,
    /// The `relays` member.
    pub relays: Option<OperationRef>,
    /// The `upstream` member.
    pub upstream: Vec<ServiceId>,
    /// The stated `maturity`, a default field `derive.wire` fills when absent.
    pub maturity: Option<OperationMaturity>,
    /// The `internal` member.
    pub internal: bool,
    /// The `format` member.
    pub format: FormatId,
    /// The `tags` member.
    pub tags: Vec<String>,
    /// The `examples` member.
    pub examples: IrMap<String, OperationExample>,
    /// The `docs` member.
    pub docs: Docs,
    /// The `extensions` member.
    pub extensions: Extensions,
    /// The `origin` member.
    pub origin: Origin,
}

/// What `tree.nodes` writes: the declared top-level members, the api without `wire`, and the
/// operations, which only this half creates.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesOutput {
    /// The `conventions` catalogue.
    pub conventions: Conventions,
    /// The `lint` member.
    pub lint: Lint,
    /// The `packs` member.
    pub packs: Vec<PackRef>,
    /// The `formats` catalogue.
    pub formats: IrMap<FormatId, WireFormat>,
    /// The `pagings` catalogue.
    pub pagings: IrMap<PagingId, PagingStyle>,
    /// The `services` catalogue.
    pub services: IrMap<ServiceId, Service>,
    /// The `api` member, every one but `wire`.
    pub api: ApiDeclaration,
    /// The operations, in declaration order.
    pub operations: Vec<TreeNodesOperation>,
}

impl From<TreeNodesInput> for DraftOperationInput {
    fn from(input: TreeNodesInput) -> Self {
        Self {
            media: input.media,
            schema: input.schema,
            body_limit_bytes: None,
            raw_body: None,
            fields: input.fields,
            proofs: None,
            origin: input.origin,
        }
    }
}

impl From<TreeNodesConcurrency> for DraftConcurrency {
    fn from(concurrency: TreeNodesConcurrency) -> Self {
        Self {
            version: concurrency.version,
            field: concurrency.field,
            derived_from: None,
        }
    }
}

impl From<TreeNodesPaging> for seampact_ir::Paging {
    fn from(paging: TreeNodesPaging) -> Self {
        Self {
            style: paging.style,
            max_limit: paging.max_limit,
            default_limit: paging.default_limit,
            over_limit: paging.over_limit,
            token: paging.token,
            sort_keys: paging
                .sort_keys
                .into_iter()
                .map(|key| SortKey {
                    key: key.key,
                    right: None,
                    params: None,
                    subject: None,
                    derived_from: None,
                    origin: key.origin,
                })
                .collect(),
            origin: paging.origin,
        }
    }
}

impl From<TreeNodesOperation> for DraftOperation {
    fn from(operation: TreeNodesOperation) -> Self {
        Self {
            kind: Some(operation.kind),
            id: Some(operation.id),
            name: Some(operation.name),
            surface: Some(operation.surface),
            op: operation.op,
            resource: operation.resource,
            method: Some(operation.method),
            path: Some(operation.path),
            safe: Some(operation.safe),
            params: Some(operation.params),
            unknown_query: Some(operation.unknown_query),
            input: operation.input.map(Into::into),
            responses: Some(operation.responses),
            concurrency: operation.concurrency.map(Into::into),
            owner: operation.owner,
            paging: operation.paging.map(Into::into),
            degradable: operation.degradable,
            budget_ms: operation.budget_ms,
            deprecated: operation.deprecated,
            relays: operation.relays,
            upstream: Some(operation.upstream),
            maturity: operation.maturity,
            internal: Some(operation.internal),
            format: Some(operation.format),
            tags: Some(operation.tags),
            examples: Some(operation.examples),
            docs: Some(operation.docs),
            extensions: Some(operation.extensions),
            origin: Some(operation.origin),
            ..Self::default()
        }
    }
}

impl TreeNodesOutput {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &[
        "conventions",
        "lint",
        "packs",
        "formats",
        "pagings",
        "services",
        "api",
        "operations",
        "operations[].kind",
        "operations[].id",
        "operations[].name",
        "operations[].surface",
        "operations[].op",
        "operations[].resource",
        "operations[].method",
        "operations[].path",
        "operations[].safe",
        "operations[].params",
        "operations[].unknownQuery",
        "operations[].input",
        "operations[].input.fields",
        "operations[].responses",
        "operations[].concurrency",
        "operations[].owner",
        "operations[].paging",
        "operations[].degradable",
        "operations[].budgetMs",
        "operations[].deprecated",
        "operations[].relays",
        "operations[].upstream",
        "operations[].maturity",
        "operations[].internal",
        "operations[].format",
        "operations[].tags",
        "operations[].examples",
        "operations[].docs",
        "operations[].extensions",
        "operations[].origin",
    ];

    /// Moves the output into the draft: the catalogues and the packs where still empty, the api
    /// and the lint where absent, and the operations, which the draft must not hold yet.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the member when the draft already holds a value there.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::TreeNodes);

        write_catalogue(
            &mut draft.conventions,
            self.conventions,
            "conventions",
            &site,
        )?;
        write_once(&mut draft.lint, self.lint, "lint", &site)?;
        write_list(&mut draft.packs, self.packs, "packs", &site)?;
        write_catalogue(&mut draft.formats, self.formats, "formats", &site)?;
        write_catalogue(&mut draft.pagings, self.pagings, "pagings", &site)?;
        write_catalogue(&mut draft.services, self.services, "services", &site)?;
        write_once(&mut draft.api, DraftApi::from(self.api), "api", &site)?;

        let operations = self
            .operations
            .into_iter()
            .map(DraftOperation::from)
            .collect();

        write_list(&mut draft.operations, operations, "operations", &site)
    }
}
