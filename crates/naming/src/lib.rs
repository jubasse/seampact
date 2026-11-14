//! The cross-language naming of ADR 0007.
//!
//! A name is word segments plus a [`Role`]; [`identifier`] turns it into the identifier of a
//! [`Language`], [`canonical_id`] into the canonical id of the IR, [`split_name`] and
//! [`segments_of`] read a written name. Every failure on a malformed input is a [`NamingError`],
//! never a guess.

mod error;
mod identifier;
mod reserved;
mod roles;
mod split;

pub use error::NamingError;
pub use identifier::{
    CanonicalIdOptions, Escape, EscapePosition, IdentifierOptions, OperationIdCase, Style,
    canonical_id, identifier, operation_id, style_of,
};
pub use reserved::{LANGUAGES, Language, assert_language, is_language, is_reserved};
pub use roles::{
    Name, ROLES, Role, SuffixRole, Suffixes, assert_name, assert_role, assert_segments,
    derive_name, is_role, is_type_role, suffix_words,
};
pub use split::{NameSource, SegmentsOptions, SegmentsResult, segments_of, split_name};
