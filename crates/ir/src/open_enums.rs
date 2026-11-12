//! Open enums: the string definitions with `x-seampact-known` values, and their registry.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A value of an open enum that this IR revision does not know, kept as read.
///
/// Only decoding builds one, so a pass cannot make an unknown value from text.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UnknownValue(String);

impl UnknownValue {
    /// The value as read.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for UnknownValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// One open enum of the IR schemas, as its registry entry lists it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenEnumEntry {
    /// The schema definition name, also the Rust type name.
    pub definition: &'static str,
    /// The `x-seampact-known` values, in schema order.
    pub known_values: &'static [&'static str],
    /// Whether the definition carries `x-seampact-must-act`.
    pub must_act: bool,
}

/// Writes each open enum, its `as_str`, `known`, `Display` and serde, and the [`OPEN_ENUMS`]
/// registry; one invocation lists every definition, so the registry cannot miss one.
macro_rules! open_enums {
    ($(
        $(#[doc = $doc:literal])*
        $name:ident, must_act: $must_act:literal {
            $($variant:ident = $value:literal,)+
        }
    )+) => {
        $(
            $(#[doc = $doc])*
            #[derive(Debug, Clone, PartialEq, Eq, Hash)]
            pub enum $name {
                $(
                    #[doc = concat!("`", $value, "`.")]
                    $variant,
                )+
                /// A value this IR revision does not know.
                Unknown(UnknownValue),
            }

            impl $name {
                /// The value as the IR writes it.
                #[must_use]
                pub fn as_str(&self) -> &str {
                    match self {
                        $(Self::$variant => $value,)+
                        Self::Unknown(value) => value.as_str(),
                    }
                }

                /// The known value written `text`, or `None` when this revision does not know it.
                #[must_use]
                pub fn known(text: &str) -> Option<Self> {
                    match text {
                        $($value => Some(Self::$variant),)+
                        _ => None,
                    }
                }
            }

            impl fmt::Display for $name {
                fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                    formatter.write_str(self.as_str())
                }
            }

            impl Serialize for $name {
                fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                    serializer.serialize_str(self.as_str())
                }
            }

            impl<'de> Deserialize<'de> for $name {
                fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    let text = String::deserialize(deserializer)?;

                    Ok(Self::known(&text).unwrap_or_else(|| Self::Unknown(UnknownValue(text))))
                }
            }
        )+

        /// Every open enum of the IR schemas, in schema file order.
        pub const OPEN_ENUMS: &[OpenEnumEntry] = &[
            $(OpenEnumEntry {
                definition: stringify!($name),
                known_values: &[$($value),+],
                must_act: $must_act,
            },)+
        ];
    };
}

open_enums! {
    /// A declaration kind (ADR 0004 section 2, ADR 0014).
    DeclarationKind, must_act: false {
        HttpOperation = "httpOperation",
    }
    /// The `Maturity` open enum.
    Maturity, must_act: false {
        Experimental = "experimental",
        Provisional = "provisional",
        Stable = "stable",
    }
    /// The `Direction` open enum.
    Direction, must_act: false {
        Input = "input",
        Output = "output",
    }
    /// The role of a name (ADR 0007 section 1).
    NameRole, must_act: false {
        Schema = "schema",
        Input = "input",
        Output = "output",
        Query = "query",
        Headers = "headers",
        Path = "path",
        Response = "response",
        Params = "params",
        Error = "error",
        Errors = "errors",
        Property = "property",
        Item = "item",
        Value = "value",
        Variant = "variant",
        Endpoints = "endpoints",
        Operation = "operation",
        Member = "member",
        EnumMember = "enumMember",
    }
    /// Where a value is read (ADR 0002 section 4); 'resolver' only as a scope source, 'holderField' only as a field right's subject source.
    ValueSourceIn, must_act: true {
        Path = "path",
        Query = "query",
        Header = "header",
        Body = "body",
        Principal = "principal",
        Scope = "scope",
        Host = "host",
        Subdomain = "subdomain",
        Address = "address",
        Resolver = "resolver",
        HolderField = "holderField",
    }
    /// A base nature: every client's retry rule reads it.
    NatureBase, must_act: false {
        Refused = "refused",
        Unavailable = "unavailable",
        Failed = "failed",
    }
    /// A role of ADR 0006 section 6.
    ErrorRole, must_act: false {
        SchemaInvalid = "schemaInvalid",
        PayloadTooLarge = "payloadTooLarge",
        UnsupportedMediaType = "unsupportedMediaType",
        Unauthenticated = "unauthenticated",
        CsrfInvalid = "csrfInvalid",
        IdempotencyKeyReused = "idempotencyKeyReused",
        IdempotencyInProgress = "idempotencyInProgress",
        StateConflict = "stateConflict",
        PreconditionFailed = "preconditionFailed",
        PreconditionRequired = "preconditionRequired",
        NotFound = "notFound",
        Forbidden = "forbidden",
        SortKeyForbidden = "sortKeyForbidden",
        RateLimited = "rateLimited",
        DeadlineExceeded = "deadlineExceeded",
        Gone = "gone",
        UpstreamUnavailable = "upstreamUnavailable",
        ServiceUnavailable = "serviceUnavailable",
        UpstreamTimeout = "upstreamTimeout",
        UndeclaredStatus = "undeclaredStatus",
    }
    /// What an identity header carries (ADR 0002 section 9).
    HeaderSemantic, must_act: false {
        Deadline = "deadline",
        TraceContext = "traceContext",
        ActorSurface = "actorSurface",
        VersionToken = "versionToken",
    }
    /// The message a header travels in.
    HeaderSide, must_act: false {
        Request = "request",
        Response = "response",
    }
    /// How a signature is encoded.
    SignatureEncoding, must_act: false {
        Hex = "hex",
        Base64 = "base64",
    }
    /// The operations an identity header applies to.
    HeaderUseFor, must_act: false {
        All = "all",
        Reads = "reads",
        Writes = "writes",
    }
    /// Where a rule proof is read.
    ProofPlacement, must_act: false {
        Body = "body",
        Header = "header",
    }
    /// The `UrlRole` open enum.
    UrlRole, must_act: false {
        SelfLink = "self",
        First = "first",
        Previous = "previous",
        Next = "next",
        Last = "last",
    }
    /// The `Absent` open enum.
    Absent, must_act: false {
        Omit = "omit",
        Null = "null",
    }
    /// Who fills a $meta member; 'source' reads the member 'source'.
    MetaFill, must_act: false {
        Now = "now",
        TraceId = "traceId",
        Degraded = "degraded",
        Handler = "handler",
        Source = "source",
    }
    /// The role of a paging request parameter.
    PagingRole, must_act: false {
        Cursor = "cursor",
        After = "after",
        Before = "before",
        Page = "page",
        Offset = "offset",
        Since = "since",
        Limit = "limit",
        Sort = "sort",
    }
    /// Where a paging request parameter is read.
    PagingParamPlacement, must_act: false {
        Query = "query",
        Header = "header",
    }
    /// How a sort parameter is written.
    PagingParamStyle, must_act: false {
        Signed = "signed",
        Pair = "pair",
        Keyed = "keyed",
        Split = "split",
    }
    /// How a paging style positions a page.
    PagingPosition, must_act: false {
        Cursor = "cursor",
        Page = "page",
        Offset = "offset",
        Since = "since",
    }
    /// What a handler returns beside a page's items.
    HandlerResultMember, must_act: false {
        NextCursor = "nextCursor",
        PreviousCursor = "previousCursor",
        Total = "total",
        More = "more",
        NextSince = "nextSince",
        Complete = "complete",
    }
    /// Whether paths carry the version prefix.
    PathVersionMode, must_act: false {
        Prefix = "prefix",
        None = "none",
    }
    /// Whether a document lists internal operations.
    InternalPolicy, must_act: false {
        Include = "include",
        Exclude = "exclude",
    }
    /// A product api or a service api.
    ApiKind, must_act: false {
        Product = "product",
        Service = "service",
    }
    /// The role of an api.
    ApiRole, must_act: false {
        Gateway = "gateway",
    }
    /// The compatibility policy the diff checks.
    CompatPolicy, must_act: false {
        AdditiveOnly = "additive-only",
        None = "none",
    }
    /// How an int64 value is sent: its string form, or a JSON number.
    Int64Wire, must_act: false {
        String = "string",
        Number = "number",
    }
    /// Whether an output enum is closed, or open with a fallback a client keeps.
    OutputEnumForm, must_act: false {
        Enum = "enum",
        Open = "open",
    }
    /// Whether a URL a target writes is a relative reference, or absolute from one configured public origin.
    UrlForm, must_act: false {
        Relative = "relative",
        Absolute = "absolute",
    }
    /// Where an extension key may appear (ADR 0002 section 12).
    ExtensionPlace, must_act: false {
        Api = "api",
        Operation = "operation",
        Schema = "schema",
        Property = "property",
        Right = "right",
        Rule = "rule",
        Scope = "scope",
    }
    /// A lint severity.
    LintSeverity, must_act: false {
        Disabled = "disabled",
        Warning = "warning",
        Error = "error",
    }
    /// The `HttpMethod` open enum.
    HttpMethod, must_act: false {
        Get = "get",
        Post = "post",
        Put = "put",
        Patch = "patch",
        Delete = "delete",
    }
    /// The `CallerKind` open enum.
    CallerKind, must_act: false {
        Anonymous = "anonymous",
        Identified = "identified",
    }
    /// How a query value is written (FR-30).
    QueryWireKind, must_act: false {
        Number = "number",
        Boolean = "boolean",
        List = "list",
        Text = "text",
        Object = "object",
    }
    /// The `OpenAPI` style of a query value.
    QueryStyle, must_act: false {
        Form = "form",
        DeepObject = "deepObject",
    }
    /// How a form or multipart field is written: a query wire kind, 'file' or 'json'.
    FieldWireKind, must_act: false {
        Number = "number",
        Boolean = "boolean",
        List = "list",
        Text = "text",
        Object = "object",
        File = "file",
        Json = "json",
    }
    /// What an optional-auth operation does with a refused credential: serve it as anonymous, or answer 401.
    RefusedCredential, must_act: true {
        Anonymous = "anonymous",
        Reject = "reject",
    }
    /// The media type of a request body.
    InputMediaType, must_act: false {
        ApplicationJson = "application/json",
        ApplicationXWwwFormUrlencoded = "application/x-www-form-urlencoded",
        MultipartFormData = "multipart/form-data",
    }
    /// What a response header carries: an identity header's semantic (declarations `HeaderSemantic`) or a deprecation header (ADR 0004 section 7).
    ResponseHeaderSemantic, must_act: false {
        Deadline = "deadline",
        TraceContext = "traceContext",
        ActorSurface = "actorSurface",
        VersionToken = "versionToken",
        Deprecation = "deprecation",
        Sunset = "sunset",
        SuccessorLink = "successorLink",
    }
    /// The format shape of a response; 'binary' and 'redirect' bypass the format (ADR 0004 section 8).
    ResponseShape, must_act: false {
        Item = "item",
        Table = "table",
        List = "list",
        Page = "page",
        Empty = "empty",
        Binary = "binary",
        Redirect = "redirect",
    }
    /// The unit of a retry header; 's' rounds the millisecond delay up.
    RetryUnit, must_act: false {
        S = "s",
        Ms = "ms",
    }
    /// An outcome that needs no decide call: 'absent', the field is never sent on this operation (ADR 0003 section 6).
    FieldRightAlways, must_act: true {
        Absent = "absent",
    }
    /// Where the idempotency key is enforced.
    IdempotencyEnforcement, must_act: false {
        Boundary = "boundary",
        None = "none",
    }
    /// Who owns the resource an operation writes.
    OwnerKind, must_act: false {
        Caller = "caller",
    }
    /// Whether a shared cache may store an anonymous response.
    CacheVisibility, must_act: false {
        Public = "public",
        Private = "private",
    }
    /// What a limit above maxLimit does.
    OverLimitPolicy, must_act: false {
        Reject = "reject",
        Clamp = "clamp",
    }
    /// What a paging token holds.
    PagingToken, must_act: false {
        Opaque = "opaque",
        Instant = "instant",
    }
    /// Where an operation's maturity comes from.
    MaturitySource, must_act: false {
        Api = "api",
        Upstream = "upstream",
        Stated = "stated",
    }
    /// The ops shorthand an operation came from.
    OpShorthand, must_act: false {
        List = "list",
        Get = "get",
        Create = "create",
        Update = "update",
        Delete = "delete",
        Batch = "batch",
    }
    /// What the boundary does with a restricted input field sent without the right (A21).
    InputPolicy, must_act: true {
        Reject = "reject",
        Strip = "strip",
    }
    /// What an input use does with unknown keys (ADR 0003 section 4).
    UnknownKeysPolicy, must_act: true {
        Refuse = "refuse",
        Ignore = "ignore",
        Keep = "keep",
    }
    /// The media type of a JSON text field.
    JsonMediaType, must_act: false {
        ApplicationJson = "application/json",
    }
    /// The JSON type of a scalar.
    ScalarType, must_act: false {
        String = "string",
        Integer = "integer",
        Number = "number",
        Boolean = "boolean",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_value_reads_as_its_variant_and_an_unknown_one_is_kept() {
        let known: Maturity = serde_json::from_str(r#""stable""#).unwrap();
        let unknown: Maturity = serde_json::from_str(r#""deprecated""#).unwrap();

        assert_eq!(known, Maturity::Stable);
        assert_eq!(unknown.as_str(), "deprecated");
        assert!(matches!(unknown, Maturity::Unknown(_)));
        assert_eq!(serde_json::to_string(&unknown).unwrap(), r#""deprecated""#);
    }

    #[test]
    fn known_refuses_text_this_revision_does_not_know() {
        assert_eq!(UrlRole::known("self"), Some(UrlRole::SelfLink));
        assert_eq!(UrlRole::known("Self"), None);
    }
}
