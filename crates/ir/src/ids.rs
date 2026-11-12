//! Id and name newtypes: they tell kinds apart and check nothing.
//!
//! The id grammar is a diagnostic of the passes and a check of the schema, not a type error.

use std::borrow::Borrow;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Writes each newtype over `String` with `new`, `as_str`, `Display`, `AsRef<str>` and
/// `Borrow<str>`, so an IR map keyed by it is looked up with a `&str`.
macro_rules! ir_ids {
    ($($(#[doc = $doc:literal])* $name:ident;)+) => {
        $(
            $(#[doc = $doc])*
            #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
            #[serde(transparent)]
            pub struct $name(String);

            impl $name {
                /// Wraps `text` as written; nothing is checked.
                #[must_use]
                pub fn new(text: String) -> Self {
                    Self(text)
                }

                /// The text as written.
                #[must_use]
                pub fn as_str(&self) -> &str {
                    &self.0
                }
            }

            impl fmt::Display for $name {
                fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                    formatter.write_str(&self.0)
                }
            }

            impl AsRef<str> for $name {
                fn as_ref(&self) -> &str {
                    &self.0
                }
            }

            impl Borrow<str> for $name {
                fn borrow(&self) -> &str {
                    &self.0
                }
            }
        )+
    };
}

ir_ids! {
    /// The id of a named schema: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4, ADR 0007).
    SchemaId;
    /// The id of a named format: its catalogue key (ADR 0003 section 8, ADR 0002 section 4).
    ScalarId;
    /// The id of an enum: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004 section 9, ADR 0002 section 4).
    EnumId;
    /// An error code, the key of the errors catalogue (ADR 0004 section 4, ADR 0002 section 4).
    ErrorCode;
    /// The id of a contract nature: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    NatureId;
    /// The id of a security scheme: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    SchemeId;
    /// The id of an identity header: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    HeaderId;
    /// The id of an identity: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    IdentityId;
    /// The id of a right: its catalogue key, the name its library uses, without line breaks or leading or trailing space (ADR 0002 section 4).
    RightId;
    /// The id of a rule: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    RuleId;
    /// The id of a scope: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    ScopeId;
    /// The id of a rate-limit bucket: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    BucketId;
    /// The id of a service: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    ServiceId;
    /// A declared extension key, written `<prefix>-<key>` (ADR 0002 sections 4 and 12).
    ExtensionKeyId;
    /// An extension prefix (ADR 0002 section 4); the compiler refuses 'seampact', which is reserved.
    ExtensionPrefix;
    /// An extension key under its prefix (ADR 0002 section 4).
    ExtensionKey;
    /// The id of a wire format: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    FormatId;
    /// The id of a paging style: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    PagingId;
    /// The id of an api surface: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    SurfaceId;
    /// The id of an api document: its catalogue key (ADR 0004 section 9, ADR 0002 section 4).
    DocumentId;
    /// The id of a principal variant: its catalogue key (ADR 0004 section 9).
    VariantId;
    /// An operation id (ADR 0004 section 7).
    OperationId;
    /// A derivation id of the derivation table (ADR 0006 section 5), `pack.<pack>.<entry>` for a pack entry.
    DerivationId;
    /// A must-understand feature name (ADR 0005 section 3); none is defined at irRevision 2.
    Feature;
    /// The written reason of an exception: non-empty, without leading or trailing white space (A36, ADR 0002 section 4).
    Reason;
    /// A slot of the template language (ADR 0002 sections 13 and 14), without its '$'.
    Slot;
    /// A number written as a decimal literal string, so an int64 or decimal bound and a long multipleOf keep every digit in every language (ADR 0003 section 8).
    DecimalLiteral;
    /// The name of a pack, the part of `Origin.layer` after `pack:`.
    PackName;
}
