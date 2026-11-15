//! Value sources in their IR form (ADR 0002 section 4, ADR 0004 section 13).

use seampact_ir::ValueSource;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;

pub(crate) const NAMED_SOURCES: &[&str] =
    &["path", "query", "header", "body", "principal", "scope"];

pub(crate) const BARE_SOURCES: &[&str] = &["host", "subdomain", "address", "resolver"];

pub(crate) fn is_named_source(_text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isNamedSource"))
}

pub(crate) fn is_bare_source(_text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isBareSource"))
}

pub(crate) fn access_rights_value_source(_text: &str) -> Result<Option<ValueSource>, PassError> {
    Err(not_ported_yet("accessRightsValueSource"))
}

pub(crate) fn access_rights_source_text(_source: &ValueSource) -> Result<String, PassError> {
    Err(not_ported_yet("accessRightsSourceText"))
}

/// Whether `text` is `address/<digits>`, the key source of an address prefix.
fn address_prefix_bits_of(_text: &str) -> Result<Option<&str>, PassError> {
    Err(not_ported_yet("ADDRESS_PREFIX"))
}
