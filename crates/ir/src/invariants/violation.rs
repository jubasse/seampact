//! The invariant ids, one violation, and the list that collects them.

use std::fmt;

/// The stable id of one cross-member rule of the IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IrInvariantId {
    /// A name has `status` if and only if its role is `response`.
    NameStatus,
    /// A `$meta` member has `source` if and only if `fill` is `source`.
    MetaSource,
    /// The members a value source of each kind has.
    ValueSourceMembers,
    /// Where a `resolver` or `holderField` source may sit.
    ValueSourcePlace,
    /// The members of a header declaration.
    HeaderMembers,
    /// Cache `directives` against the `never` family.
    CacheDirectives,
    /// A response with a sensitive value is never stored.
    CacheSensitiveNoStore,
    /// An unsafe operation reached through a cookie scheme has `csrf`.
    CsrfCookie,
    /// The members of a field's wire form.
    FieldWireMembers,
    /// A property holds `nullable`, its type use does not.
    PropertyNullable,
    /// A property holds `sensitive`, its type use does not.
    PropertySensitive,
    /// A named format's own type names no `scalar`.
    ScalarType,
    /// An id's type use is a scalar or an enum; a proof's is neither opaque nor file.
    IdScalar,
    /// A catalogue id names an existing entry.
    RefResolves,
    /// A core origin points at an entry of a core catalogue.
    OriginCore,
    /// A body proof's wire form.
    InputProofWire,
    /// A body proof's name.
    InputProofName,
    /// The input of a body proof.
    InputProofInput,
    /// A field right with `always`.
    FieldRightAlways,
    /// A sort key's right and subject.
    SortKeyRight,
    /// An opaque value is exact.
    ValueExactNumber,
    /// A degradable operation's header.
    DegradableHeader,
    /// The deprecation headers of the responses and the successor.
    DeprecationHeaders,
    /// The dates of a deprecation.
    DeprecationSince,
    /// A role is bound once per operation.
    OperationRoleOnce,
    /// The params of a role binding.
    ErrorRoleParams,
    /// A retry header.
    ErrorRetryHeader,
    /// An error code whose params carry a sensitive value is never stored.
    ErrorSensitiveNoStore,
}

impl IrInvariantId {
    /// The dotted id the diagnostics and the documentation use (`ir.name.status`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NameStatus => "ir.name.status",
            Self::MetaSource => "ir.meta.source",
            Self::ValueSourceMembers => "ir.value-source.members",
            Self::ValueSourcePlace => "ir.value-source.place",
            Self::HeaderMembers => "ir.header.members",
            Self::CacheDirectives => "ir.cache.directives",
            Self::CacheSensitiveNoStore => "ir.cache.sensitive-no-store",
            Self::CsrfCookie => "ir.csrf.cookie",
            Self::FieldWireMembers => "ir.field-wire.members",
            Self::PropertyNullable => "ir.property.nullable",
            Self::PropertySensitive => "ir.property.sensitive",
            Self::ScalarType => "ir.scalar.type",
            Self::IdScalar => "ir.id.scalar",
            Self::RefResolves => "ir.ref.resolves",
            Self::OriginCore => "ir.origin.core",
            Self::InputProofWire => "ir.input-proof.wire",
            Self::InputProofName => "ir.input-proof.name",
            Self::InputProofInput => "ir.input-proof.input",
            Self::FieldRightAlways => "ir.field-right.always",
            Self::SortKeyRight => "ir.sort-key.right",
            Self::ValueExactNumber => "ir.value.exact-number",
            Self::DegradableHeader => "ir.degradable.header",
            Self::DeprecationHeaders => "ir.deprecation.headers",
            Self::DeprecationSince => "ir.deprecation.since",
            Self::OperationRoleOnce => "ir.operation.role-once",
            Self::ErrorRoleParams => "ir.error.role-params",
            Self::ErrorRetryHeader => "ir.error.retry-header",
            Self::ErrorSensitiveNoStore => "ir.error.sensitive-no-store",
        }
    }
}

impl fmt::Display for IrInvariantId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One broken invariant of an IR document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrInvariantViolation {
    /// The rule that is broken.
    pub id: IrInvariantId,
    /// The JSON pointer of the object that breaks it.
    pub pointer: String,
    /// What the rule asks.
    pub message: String,
}

/// The violations found so far, in the order the rules ran.
#[derive(Debug, Default)]
pub(super) struct Violations(Vec<IrInvariantViolation>);

impl Violations {
    pub(super) fn fail(&mut self, id: IrInvariantId, pointer: &str, message: String) {
        self.0.push(IrInvariantViolation {
            id,
            pointer: pointer.to_owned(),
            message,
        });
    }

    pub(super) fn into_vec(self) -> Vec<IrInvariantViolation> {
        self.0
    }
}
