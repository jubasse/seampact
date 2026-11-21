//! The fix and the troubleshooting section of each form a target refuses as not generated yet, so
//! that every refusal says what to change on its own.

/// The troubleshooting page of the refusals `generate` prints.
pub const GENERATE_TROUBLESHOOTING_URL: &str =
    "https://jubasse.github.io/seampact/troubleshooting/generate/";

/// The troubleshooting page of the refusals a link target prints.
pub const LINK_TROUBLESHOOTING_URL: &str =
    "https://jubasse.github.io/seampact/troubleshooting/link/";

/// A section of the generate troubleshooting page that holds the Node targets' refusals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum GenerateTroubleshootingSection {
    /// `clients`.
    Clients,
    /// `node-servers`.
    NodeServers,
    /// `every-node-target`.
    EveryNodeTarget,
    /// `every-server`.
    EveryServer,
    /// `openapi-documents`.
    OpenapiDocuments,
}

impl GenerateTroubleshootingSection {
    /// The heading anchor of the section.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clients => "clients",
            Self::NodeServers => "node-servers",
            Self::EveryNodeTarget => "every-node-target",
            Self::EveryServer => "every-server",
            Self::OpenapiDocuments => "openapi-documents",
        }
    }
}

/// A form of the IR a target knows but does not generate yet: its refusal code is
/// `<form>.unsupported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum NotGeneratedForm {
    /// `type.nullable`.
    TypeNullable,
    /// `type.file`.
    TypeFile,
    /// `schema.union`.
    SchemaUnion,
    /// `schema.map`.
    SchemaMap,
    /// `schema.recursive`.
    SchemaRecursive,
    /// `property.codeName`.
    PropertyCodeName,
    /// `property.restrictedTo.required`.
    PropertyRestrictedToRequired,
    /// `enum.codeNames`.
    EnumCodeNames,
    /// `enum.fallback`.
    EnumFallback,
    /// `enum.narrowedTo`.
    EnumNarrowedTo,
    /// `unknownKeys.ignore`.
    UnknownKeysIgnore,
    /// `unknownKeys.keep`.
    UnknownKeysKeep,
    /// `unknownQuery.ignore`.
    UnknownQueryIgnore,
    /// `scalar.content`.
    ScalarContent,
    /// `scalar.format`.
    ScalarFormat,
    /// `scalar.named`.
    ScalarNamed,
    /// `scalar.bound.inexact`.
    ScalarBoundInexact,
    /// `param.default`.
    ParamDefault,
    /// `input.media`.
    InputMedia,
    /// `input.proofs`.
    InputProofs,
    /// `response.media`.
    ResponseMedia,
    /// `response.header`.
    ResponseHeader,
    /// `query.wire`.
    QueryWire,
    /// `wire.outputEnums.open`.
    WireOutputEnumsOpen,
    /// `wire.urls.absolute`.
    WireUrlsAbsolute,
    /// `path.param.type`.
    PathParamType,
    /// `header.param.type`.
    HeaderParamType,
    /// `query.style`.
    QueryStyle,
    /// `input.union.headerTag`.
    InputUnionHeaderTag,
    /// `error.params.shape`.
    ErrorParamsShape,
    /// `deprecated`.
    Deprecated,
    /// `degradable.header`.
    DegradableHeader,
    /// `format.error.body`.
    FormatErrorBody,
    /// `format.error.media`.
    FormatErrorMedia,
    /// `paging.response.headers.member`.
    PagingResponseHeadersMember,
    /// `paging.response.headers.text`.
    PagingResponseHeadersText,
    /// `path.segment.literal`.
    PathSegmentLiteral,
    /// `mock.page.fact`.
    MockPageFact,
    /// `mock.envelope.member`.
    MockEnvelopeMember,
    /// `mock.error.member`.
    MockErrorMember,
    /// `access.optional`.
    AccessOptional,
    /// `fieldRight.nestedPointer`.
    FieldRightNestedPointer,
    /// `idempotency.enforce`.
    IdempotencyEnforce,
    /// `paging.sortKey.restricted`.
    PagingSortKeyRestricted,
    /// `paging.sort.style`.
    PagingSortStyle,
    /// `paging.sort.in`.
    PagingSortIn,
    /// `paging.request.in`.
    PagingRequestIn,
    /// `paging.response.header`.
    PagingResponseHeader,
    /// `paging.response.items`.
    PagingResponseItems,
    /// `input.body.topLevel`.
    InputBodyTopLevel,
    /// `path.segment.mixed`.
    PathSegmentMixed,
    /// `output.file`.
    OutputFile,
    /// `output.opaque`.
    OutputOpaque,
    /// `output.schema`.
    OutputSchema,
    /// `format.several`.
    FormatSeveral,
    /// `format.error.codeless`.
    FormatErrorCodeless,
    /// `format.error.headers`.
    FormatErrorHeaders,
    /// `format.template`.
    FormatTemplate,
    /// `format.memberName`.
    FormatMemberName,
    /// `principal.variants`.
    PrincipalVariants,
    /// `scope.source`.
    ScopeSource,
    /// `signature.application`.
    SignatureApplication,
    /// `signature.key.source`.
    SignatureKeySource,
    /// `rule.proof.placement`.
    RuleProofPlacement,
    /// `valueSource`.
    ValueSource,
    /// `principalRequires`.
    PrincipalRequires,
    /// `bindings`.
    Bindings,
    /// `upstream`.
    Upstream,
    /// `features`.
    Features,
    /// `extensions`.
    Extensions,
    /// `wire.name.vinePath`.
    WireNameVinePath,
    /// `wire.name.yupPath`.
    WireNameYupPath,
    /// `dto.listOfLists`.
    DtoListOfLists,
    /// `dto.memberName`.
    DtoMemberName,
    /// `format.meta`.
    FormatMeta,
    /// `format.success.envelope`.
    FormatSuccessEnvelope,
    /// `format.success.slot`.
    FormatSuccessSlot,
    /// `format.success.headers`.
    FormatSuccessHeaders,
    /// `paging.response.slot`.
    PagingResponseSlot,
    /// `scheme.query`.
    SchemeQuery,
    /// `scheme.basic`.
    SchemeBasic,
    /// `scheme.signature`.
    SchemeSignature,
    /// `degradable`.
    Degradable,
    /// `concurrency.etag.withoutWrite`.
    ConcurrencyEtagWithoutWrite,
    /// `deprecated.successor.otherApi`.
    DeprecatedSuccessorOtherApi,
    /// `identity.response.header`.
    IdentityResponseHeader,
    /// `right.extensions`.
    RightExtensions,
    /// `rule.extensions`.
    RuleExtensions,
    /// `scope.extensions`.
    ScopeExtensions,
    /// `property.default`.
    PropertyDefault,
    /// `query.list.brackets`.
    QueryListBrackets,
    /// `response.shape`.
    ResponseShape,
    /// `path.segment.encoded`.
    PathSegmentEncoded,
    /// `openapi.scheme.bearer`.
    OpenapiSchemeBearer,
    /// `openapi.format.error.headers`.
    OpenapiFormatErrorHeaders,
    /// `openapi.error.formats`.
    OpenapiErrorFormats,
    /// `openapi.paging.headers`.
    OpenapiPagingHeaders,
    /// `openapi.sensitive.shape`.
    OpenapiSensitiveShape,
    /// `openapi.response.shape`.
    OpenapiResponseShape,
    /// `openapi.example.request`.
    OpenapiExampleRequest,
    /// `openapi.input.brackets`.
    OpenapiInputBrackets,
    /// `openapi.format.success.headers`.
    OpenapiFormatSuccessHeaders,
    /// `openapi.template.array`.
    OpenapiTemplateArray,
    /// `openapi.template.each`.
    OpenapiTemplateEach,
    /// `openapi.template.slot-path`.
    OpenapiTemplateSlotPath,
    /// `openapi.template.slot`.
    OpenapiTemplateSlot,
    /// `openapi.template.member-name`.
    OpenapiTemplateMemberName,
    /// `openapi.template.member-repeated`.
    OpenapiTemplateMemberRepeated,
    /// `openapi.example.slot`.
    OpenapiExampleSlot,
    /// `openapi.example.template`.
    OpenapiExampleTemplate,
    /// `openapi.example.merge`.
    OpenapiExampleMerge,
    /// `openapi.example.member-name`.
    OpenapiExampleMemberName,
    /// `openapi.example.error`.
    OpenapiExampleError,
    /// `openapi.example.status`.
    OpenapiExampleStatus,
    /// `openapi.example.shape`.
    OpenapiExampleShape,
    /// `openapi.example.empty`.
    OpenapiExampleEmpty,
}

/// The row of a form in the TypeScript table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NotGeneratedFix {
    key: &'static str,
    fix: &'static str,
    section: GenerateTroubleshootingSection,
}

impl NotGeneratedForm {
    /// Every form, in the order of the TypeScript table.
    pub const ALL: &'static [Self] = &[
        Self::TypeNullable,
        Self::TypeFile,
        Self::SchemaUnion,
        Self::SchemaMap,
        Self::SchemaRecursive,
        Self::PropertyCodeName,
        Self::PropertyRestrictedToRequired,
        Self::EnumCodeNames,
        Self::EnumFallback,
        Self::EnumNarrowedTo,
        Self::UnknownKeysIgnore,
        Self::UnknownKeysKeep,
        Self::UnknownQueryIgnore,
        Self::ScalarContent,
        Self::ScalarFormat,
        Self::ScalarNamed,
        Self::ScalarBoundInexact,
        Self::ParamDefault,
        Self::InputMedia,
        Self::InputProofs,
        Self::ResponseMedia,
        Self::ResponseHeader,
        Self::QueryWire,
        Self::WireOutputEnumsOpen,
        Self::WireUrlsAbsolute,
        Self::PathParamType,
        Self::HeaderParamType,
        Self::QueryStyle,
        Self::InputUnionHeaderTag,
        Self::ErrorParamsShape,
        Self::Deprecated,
        Self::DegradableHeader,
        Self::FormatErrorBody,
        Self::FormatErrorMedia,
        Self::PagingResponseHeadersMember,
        Self::PagingResponseHeadersText,
        Self::PathSegmentLiteral,
        Self::MockPageFact,
        Self::MockEnvelopeMember,
        Self::MockErrorMember,
        Self::AccessOptional,
        Self::FieldRightNestedPointer,
        Self::IdempotencyEnforce,
        Self::PagingSortKeyRestricted,
        Self::PagingSortStyle,
        Self::PagingSortIn,
        Self::PagingRequestIn,
        Self::PagingResponseHeader,
        Self::PagingResponseItems,
        Self::InputBodyTopLevel,
        Self::PathSegmentMixed,
        Self::OutputFile,
        Self::OutputOpaque,
        Self::OutputSchema,
        Self::FormatSeveral,
        Self::FormatErrorCodeless,
        Self::FormatErrorHeaders,
        Self::FormatTemplate,
        Self::FormatMemberName,
        Self::PrincipalVariants,
        Self::ScopeSource,
        Self::SignatureApplication,
        Self::SignatureKeySource,
        Self::RuleProofPlacement,
        Self::ValueSource,
        Self::PrincipalRequires,
        Self::Bindings,
        Self::Upstream,
        Self::Features,
        Self::Extensions,
        Self::WireNameVinePath,
        Self::WireNameYupPath,
        Self::DtoListOfLists,
        Self::DtoMemberName,
        Self::FormatMeta,
        Self::FormatSuccessEnvelope,
        Self::FormatSuccessSlot,
        Self::FormatSuccessHeaders,
        Self::PagingResponseSlot,
        Self::SchemeQuery,
        Self::SchemeBasic,
        Self::SchemeSignature,
        Self::Degradable,
        Self::ConcurrencyEtagWithoutWrite,
        Self::DeprecatedSuccessorOtherApi,
        Self::IdentityResponseHeader,
        Self::RightExtensions,
        Self::RuleExtensions,
        Self::ScopeExtensions,
        Self::PropertyDefault,
        Self::QueryListBrackets,
        Self::ResponseShape,
        Self::PathSegmentEncoded,
        Self::OpenapiSchemeBearer,
        Self::OpenapiFormatErrorHeaders,
        Self::OpenapiErrorFormats,
        Self::OpenapiPagingHeaders,
        Self::OpenapiSensitiveShape,
        Self::OpenapiResponseShape,
        Self::OpenapiExampleRequest,
        Self::OpenapiInputBrackets,
        Self::OpenapiFormatSuccessHeaders,
        Self::OpenapiTemplateArray,
        Self::OpenapiTemplateEach,
        Self::OpenapiTemplateSlotPath,
        Self::OpenapiTemplateSlot,
        Self::OpenapiTemplateMemberName,
        Self::OpenapiTemplateMemberRepeated,
        Self::OpenapiExampleSlot,
        Self::OpenapiExampleTemplate,
        Self::OpenapiExampleMerge,
        Self::OpenapiExampleMemberName,
        Self::OpenapiExampleError,
        Self::OpenapiExampleStatus,
        Self::OpenapiExampleShape,
        Self::OpenapiExampleEmpty,
    ];

    /// The key of the form in the TypeScript table, the prefix of its refusal code.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.row().key
    }

    /// The fix the refusal of the form gives.
    #[must_use]
    pub const fn fix(self) -> &'static str {
        self.row().fix
    }

    /// The troubleshooting section that holds the form's row.
    #[must_use]
    pub const fn section(self) -> GenerateTroubleshootingSection {
        self.row().section
    }

    #[expect(
        clippy::too_many_lines,
        reason = "the TypeScript table, one arm per form"
    )]
    const fn row(self) -> NotGeneratedFix {
        match self {
            Self::TypeNullable => NotGeneratedFix {
                key: "type.nullable",
                fix: "Ask the user first: make the value not nullable, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::TypeFile => NotGeneratedFix {
                key: "type.file",
                fix: "Ask the user first: remove the operations that send or return a file from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::SchemaUnion => NotGeneratedFix {
                key: "schema.union",
                fix: "Ask the user first: write the schema as an object, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::SchemaMap => NotGeneratedFix {
                key: "schema.map",
                fix: "Ask the user first: write the schema as an object with named members, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::SchemaRecursive => NotGeneratedFix {
                key: "schema.recursive",
                fix: "Ask the user first: break the cycle so the schema does not reach itself, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::PropertyCodeName => NotGeneratedFix {
                key: "property.codeName",
                fix: "Ask the user first: remove the property's `codeName`. The generated name then follows the wire name, which renames the code a Spring Boot, PHP or Python target generates from the same contract.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::PropertyRestrictedToRequired => NotGeneratedFix {
                key: "property.restrictedTo.required",
                fix: "Ask the user first: make the restricted property optional (end its name with `?`), or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::EnumCodeNames => NotGeneratedFix {
                key: "enum.codeNames",
                fix: "Ask the user first: remove the enum's `codeNames`. The generated names then follow the values, which renames the code a Spring Boot, PHP or Python target generates from the same contract.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::EnumFallback => NotGeneratedFix {
                key: "enum.fallback",
                fix: "Ask the user first: remove the enum's `fallback`, or the operations that use the enum from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::EnumNarrowedTo => NotGeneratedFix {
                key: "enum.narrowedTo",
                fix: "Ask the user first: use the whole enum instead of a narrowed one, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::UnknownKeysIgnore => NotGeneratedFix {
                key: "unknownKeys.ignore",
                fix: "Ask the user first: remove the `unknownKeys` exception, so unknown keys are refused, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::UnknownKeysKeep => NotGeneratedFix {
                key: "unknownKeys.keep",
                fix: "Ask the user first: remove the `unknownKeys` exception, so unknown keys are refused, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::UnknownQueryIgnore => NotGeneratedFix {
                key: "unknownQuery.ignore",
                fix: "Ask the user first: remove the `unknownQuery` exception, so unknown query keys are refused, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ScalarContent => NotGeneratedFix {
                key: "scalar.content",
                fix: "Ask the user first: declare the field as an object schema instead of JSON text, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ScalarFormat => NotGeneratedFix {
                key: "scalar.format",
                fix: "Ask the user first: remove the `format` of that value, or the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ScalarNamed => NotGeneratedFix {
                key: "scalar.named",
                fix: "Ask the user first: use a built-in type instead of that named format, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ScalarBoundInexact => NotGeneratedFix {
                key: "scalar.bound.inexact",
                fix: "Ask the user first: use 0 or a bound of at least 0.000001 in magnitude (change the unit if needed), or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ParamDefault => NotGeneratedFix {
                key: "param.default",
                fix: "Ask the user first: remove the parameter's `default`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::InputMedia => NotGeneratedFix {
                key: "input.media",
                fix: "Ask the user first: send the body as JSON, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::InputProofs => NotGeneratedFix {
                key: "input.proofs",
                fix: "Ask the user first: make the body an object schema, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ResponseMedia => NotGeneratedFix {
                key: "response.media",
                fix: "Ask the user first: return a JSON body, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::ResponseHeader => NotGeneratedFix {
                key: "response.header",
                fix: "Ask the user first: remove the header from the route's response, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::QueryWire => NotGeneratedFix {
                key: "query.wire",
                fix: "Ask the user first: make the query parameter a scalar, an enum or a list of them in the `form` style, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::WireOutputEnumsOpen => NotGeneratedFix {
                key: "wire.outputEnums.open",
                fix: "Ask the user first: set `conventions.outputEnums` to `enum`, or use another target.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::WireUrlsAbsolute => NotGeneratedFix {
                key: "wire.urls.absolute",
                fix: "Ask the user first: set `conventions.urls` to `relative`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::PathParamType => NotGeneratedFix {
                key: "path.param.type",
                fix: "Ask the user first: make the path parameter a scalar or an enum, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::HeaderParamType => NotGeneratedFix {
                key: "header.param.type",
                fix: "Ask the user first: make the header parameter a scalar or an enum, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::QueryStyle => NotGeneratedFix {
                key: "query.style",
                fix: "Ask the user first: send the query value in the `form` style, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::InputUnionHeaderTag => NotGeneratedFix {
                key: "input.union.headerTag",
                fix: "Remove the operation from the client entry's `operations`: no Node target generates a union yet.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::ErrorParamsShape => NotGeneratedFix {
                key: "error.params.shape",
                fix: "Ask the user first: declare the error's params as an object, or remove the operations that answer the error from `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::Deprecated => NotGeneratedFix {
                key: "deprecated",
                fix: "Ask the user first: remove the operation from `operations`, or drop its `deprecated`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::DegradableHeader => NotGeneratedFix {
                key: "degradable.header",
                fix: "Ask the user first: remove the operation's `degradable`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::FormatErrorBody => NotGeneratedFix {
                key: "format.error.body",
                fix: "Ask the user first: use an error format whose body has a top-level `code` member and merged params.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::FormatErrorMedia => NotGeneratedFix {
                key: "format.error.media",
                fix: "Ask the user first: use an error format with a JSON body.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::PagingResponseHeadersMember => NotGeneratedFix {
                key: "paging.response.headers.member",
                fix: "Ask the user first: write that paging header as its role alone, or remove the header from the paging style.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::PagingResponseHeadersText => NotGeneratedFix {
                key: "paging.response.headers.text",
                fix: "Ask the user first: write that paging header as its role alone, with no text around it, or remove the header from the paging style.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::PathSegmentLiteral => NotGeneratedFix {
                key: "path.segment.literal",
                fix: "Ask the user first: remove the `*`, or the `:` and digits at its end, from that path segment, or remove the operation from the MSW entry's `operations`.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::MockPageFact => NotGeneratedFix {
                key: "mock.page.fact",
                fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use a paging style whose page facts the handler result gives.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::MockEnvelopeMember => NotGeneratedFix {
                key: "mock.envelope.member",
                fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use a format whose success body the mock fills.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::MockErrorMember => NotGeneratedFix {
                key: "mock.error.member",
                fix: "Remove the operation from the MSW entry's `operations`, or ask the user first to use an error format whose members are fixed names.",
                section: GenerateTroubleshootingSection::Clients,
            },
            Self::AccessOptional => NotGeneratedFix {
                key: "access.optional",
                fix: "Ask the user first: make the access required or public, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FieldRightNestedPointer => NotGeneratedFix {
                key: "fieldRight.nestedPointer",
                fix: "Ask the user first: move the right to a top-level field, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::IdempotencyEnforce => NotGeneratedFix {
                key: "idempotency.enforce",
                fix: "Ask the user first: keep `idempotency.enforce: boundary`, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingSortKeyRestricted => NotGeneratedFix {
                key: "paging.sortKey.restricted",
                fix: "Ask the user first: leave the key out of `sortable`, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingSortStyle => NotGeneratedFix {
                key: "paging.sort.style",
                fix: "Ask the user first: set the paging style's sort to `style: signed`, or remove the operations that use the style from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingSortIn => NotGeneratedFix {
                key: "paging.sort.in",
                fix: "Ask the user first: read the sort from the query (`sort: { query: <name> }`), or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingRequestIn => NotGeneratedFix {
                key: "paging.request.in",
                fix: "Ask the user first: read that paging role from the query (`{ query: <name> }`), or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingResponseHeader => NotGeneratedFix {
                key: "paging.response.header",
                fix: "Ask the user first: remove the header from the paging style's `response`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PagingResponseItems => NotGeneratedFix {
                key: "paging.response.items",
                fix: "Ask the user first: use a page body that writes `$items` under named members, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::InputBodyTopLevel => NotGeneratedFix {
                key: "input.body.topLevel",
                fix: "Ask the user first: make the request body a plain object schema, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PathSegmentMixed => NotGeneratedFix {
                key: "path.segment.mixed",
                fix: "Ask the user first: write each path segment as a whole parameter or as whole text, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::OutputFile => NotGeneratedFix {
                key: "output.file",
                fix: "Ask the user first: remove the operations that return a file from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::OutputOpaque => NotGeneratedFix {
                key: "output.opaque",
                fix: "Ask the user first: declare the type of the opaque value, or remove the operations that return it from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::OutputSchema => NotGeneratedFix {
                key: "output.schema",
                fix: "Ask the user first: make the output schema an object, or remove the operations that return it from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatSeveral => NotGeneratedFix {
                key: "format.several",
                fix: "Ask the user first: use one format for every operation of the api, or split the api.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatErrorCodeless => NotGeneratedFix {
                key: "format.error.codeless",
                fix: "Ask the user first: use an error format whose body writes `$code`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatErrorHeaders => NotGeneratedFix {
                key: "format.error.headers",
                fix: "Ask the user first: use an error format with no headers.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatTemplate => NotGeneratedFix {
                key: "format.template",
                fix: "Ask the user first: use a format made of slots, literals, `each` and objects with fixed member names.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatMemberName => NotGeneratedFix {
                key: "format.memberName",
                fix: "Ask the user first: use a format whose member names are fixed text.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PrincipalVariants => NotGeneratedFix {
                key: "principal.variants",
                fix: "Ask the user first: use one principal schema, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::ScopeSource => NotGeneratedFix {
                key: "scope.source",
                fix: "Ask the user first: read the scope id from the path, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::SignatureApplication => NotGeneratedFix {
                key: "signature.application",
                fix: "Ask the user first: use a signature template with a key value, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::SignatureKeySource => NotGeneratedFix {
                key: "signature.key.source",
                fix: "Ask the user first: use a signature template with a key value, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::RuleProofPlacement => NotGeneratedFix {
                key: "rule.proof.placement",
                fix: "Ask the user first: send the rule proof in the body, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::ValueSource => NotGeneratedFix {
                key: "valueSource",
                fix: "Ask the user first: read the value from the path, a scope, the principal or a holder field, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::PrincipalRequires => NotGeneratedFix {
                key: "principalRequires",
                fix: "Ask the user first: remove the operation's `principal: { requires: [...] }`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::Bindings => NotGeneratedFix {
                key: "bindings",
                fix: "Ask the user first: remove the operation's principal bindings, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::Upstream => NotGeneratedFix {
                key: "upstream",
                fix: "Ask the user first: remove the operation's `upstream`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::Features => NotGeneratedFix {
                key: "features",
                fix: "Compile the contract with the seampact release this target reads: a newer compiler wrote this IR.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::Extensions => NotGeneratedFix {
                key: "extensions",
                fix: "Ask the user first: remove the operation's extension values, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::WireNameVinePath => NotGeneratedFix {
                key: "wire.name.vinePath",
                fix: "Ask the user first: rename the member to letters, digits and `_`, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::WireNameYupPath => NotGeneratedFix {
                key: "wire.name.yupPath",
                fix: "Use another validator target, such as Zod, or ask the user first to rename the member without `[`, `]` or `\"`.",
                section: GenerateTroubleshootingSection::EveryNodeTarget,
            },
            Self::DtoListOfLists => NotGeneratedFix {
                key: "dto.listOfLists",
                fix: "Ask the user first: wrap the inner list in an object schema, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::DtoMemberName => NotGeneratedFix {
                key: "dto.memberName",
                fix: "Ask the user first: rename the member in the contract, or remove the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::NodeServers,
            },
            Self::FormatMeta => NotGeneratedFix {
                key: "format.meta",
                fix: "Ask the user first: use a format with no meta member.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::FormatSuccessEnvelope => NotGeneratedFix {
                key: "format.success.envelope",
                fix: "Ask the user first: use a format whose envelope puts `$payload` under named members.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::FormatSuccessSlot => NotGeneratedFix {
                key: "format.success.slot",
                fix: "Ask the user first: use a format whose envelope writes only `$payload`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::FormatSuccessHeaders => NotGeneratedFix {
                key: "format.success.headers",
                fix: "Ask the user first: use a format with no success header.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::PagingResponseSlot => NotGeneratedFix {
                key: "paging.response.slot",
                fix: "Ask the user first: use a paging style whose page writes only its response roles, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::SchemeQuery => NotGeneratedFix {
                key: "scheme.query",
                fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::SchemeBasic => NotGeneratedFix {
                key: "scheme.basic",
                fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::SchemeSignature => NotGeneratedFix {
                key: "scheme.signature",
                fix: "Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::Degradable => NotGeneratedFix {
                key: "degradable",
                fix: "Ask the user first: remove the operation's `degradable`, or the operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::ConcurrencyEtagWithoutWrite => NotGeneratedFix {
                key: "concurrency.etag.withoutWrite",
                fix: "Ask the user first: serve the read and its writes in one api, or remove the read from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::DeprecatedSuccessorOtherApi => NotGeneratedFix {
                key: "deprecated.successor.otherApi",
                fix: "Ask the user first: name a successor in the same api, or drop the successor.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::IdentityResponseHeader => NotGeneratedFix {
                key: "identity.response.header",
                fix: "Ask the user first: remove the operations under that identity from `operations`. For a header other than a `versionToken`, you may instead declare it `in: request`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::RightExtensions => NotGeneratedFix {
                key: "right.extensions",
                fix: "Ask the user first: remove the right's `extensions`, or the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::RuleExtensions => NotGeneratedFix {
                key: "rule.extensions",
                fix: "Ask the user first: remove the rule's `extensions`, or the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::ScopeExtensions => NotGeneratedFix {
                key: "scope.extensions",
                fix: "Ask the user first: remove the scope's `extensions`, or the operations that use it from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::PropertyDefault => NotGeneratedFix {
                key: "property.default",
                fix: "Ask the user first: remove the `default`, or the operations that use the schema from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::QueryListBrackets => NotGeneratedFix {
                key: "query.list.brackets",
                fix: "Ask the user first: set `conventions.query.lists` to `repeat` or `comma`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::ResponseShape => NotGeneratedFix {
                key: "response.shape",
                fix: "Ask the user first: remove the download or redirect operation from `operations`.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::PathSegmentEncoded => NotGeneratedFix {
                key: "path.segment.encoded",
                fix: "Ask the user first: use plain ASCII letters, digits and `-` in that path segment.",
                section: GenerateTroubleshootingSection::EveryServer,
            },
            Self::OpenapiSchemeBearer => NotGeneratedFix {
                key: "openapi.scheme.bearer",
                fix: "Ask the user first: keep either the OAuth 2 flows or the OpenID Connect URL on the bearer scheme.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiFormatErrorHeaders => NotGeneratedFix {
                key: "openapi.format.error.headers",
                fix: "Ask the user first: use an error format with no headers.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiErrorFormats => NotGeneratedFix {
                key: "openapi.error.formats",
                fix: "Ask the user first: answer the error in one format.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiPagingHeaders => NotGeneratedFix {
                key: "openapi.paging.headers",
                fix: "Ask the user first: remove the headers from the paging style's `response`.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiSensitiveShape => NotGeneratedFix {
                key: "openapi.sensitive.shape",
                fix: "Ask the user first: mark only scalar values as sensitive.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiResponseShape => NotGeneratedFix {
                key: "openapi.response.shape",
                fix: "Ask the user first: remove the download or redirect operation from the document's operations.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleRequest => NotGeneratedFix {
                key: "openapi.example.request",
                fix: "Remove the request example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiInputBrackets => NotGeneratedFix {
                key: "openapi.input.brackets",
                fix: "Ask the user first: name the form field without `[` and `]`, or remove the operation from the document's operations.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiFormatSuccessHeaders => NotGeneratedFix {
                key: "openapi.format.success.headers",
                fix: "Ask the user first: use a format with no success header.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateArray => NotGeneratedFix {
                key: "openapi.template.array",
                fix: "Ask the user first: write the list with `$each` instead of an `array` template, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateEach => NotGeneratedFix {
                key: "openapi.template.each",
                fix: "Ask the user first: make `$each` read a list slot and write its `$as`, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateSlotPath => NotGeneratedFix {
                key: "openapi.template.slot-path",
                fix: "Ask the user first: write the whole slot (`$x`) instead of one of its members (`$x.y`), or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateSlot => NotGeneratedFix {
                key: "openapi.template.slot",
                fix: "Ask the user first: use a slot the format defines in that place, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateMemberName => NotGeneratedFix {
                key: "openapi.template.member-name",
                fix: "Ask the user first: give the member a fixed name instead of a slot, or leave the api out of the app's `openapi` map (`openapi: none` writes no document).",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiTemplateMemberRepeated => NotGeneratedFix {
                key: "openapi.template.member-repeated",
                fix: "Ask the user first: write each member once in the format's object.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleSlot => NotGeneratedFix {
                key: "openapi.example.slot",
                fix: "Remove the example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleTemplate => NotGeneratedFix {
                key: "openapi.example.template",
                fix: "Remove the example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleMerge => NotGeneratedFix {
                key: "openapi.example.merge",
                fix: "Remove the example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleMemberName => NotGeneratedFix {
                key: "openapi.example.member-name",
                fix: "Remove the example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleError => NotGeneratedFix {
                key: "openapi.example.error",
                fix: "Remove the error example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleStatus => NotGeneratedFix {
                key: "openapi.example.status",
                fix: "Remove the example, or give it a status the operation answers: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleShape => NotGeneratedFix {
                key: "openapi.example.shape",
                fix: "Remove the example: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
            Self::OpenapiExampleEmpty => NotGeneratedFix {
                key: "openapi.example.empty",
                fix: "Remove the example of the response without a body: it changes only the document.",
                section: GenerateTroubleshootingSection::OpenapiDocuments,
            },
        }
    }
}

/// The URL of the troubleshooting section that holds a form's row.
#[must_use]
pub fn troubleshooting_url(section: GenerateTroubleshootingSection) -> String {
    format!("{GENERATE_TROUBLESHOOTING_URL}#{}", section.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_form_has_its_own_key() {
        let mut keys: Vec<&str> = NotGeneratedForm::ALL
            .iter()
            .map(|form| form.as_str())
            .collect();

        keys.sort_unstable();
        keys.dedup();

        assert_eq!(keys.len(), NotGeneratedForm::ALL.len());
    }
}
