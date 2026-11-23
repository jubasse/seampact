//! The links a consumer receives from the providers it names.

use camino::Utf8Path;
use seampact_target::{DescriptorSet, LinkKind, LinkLocation, LinkSet};

use crate::GenerateError;
use crate::not_ported::not_ported_yet;

/// The link kind written `kind`, when it is one.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
#[expect(
    dead_code,
    reason = "called by build_links until generate_api is ported, brief 2"
)]
pub(crate) fn is_link_kind(_kind: &str) -> Result<Option<LinkKind>, GenerateError> {
    Err(not_ported_yet("isLinkKind"))
}

/// Where a consumer in `consumer_root` finds the provider in `provider_root`.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
#[expect(
    dead_code,
    reason = "called by build_links until generate_api is ported, brief 2"
)]
pub(crate) fn relative_location(
    _consumer_root: &Utf8Path,
    _provider_root: &Utf8Path,
) -> Result<LinkLocation, GenerateError> {
    Err(not_ported_yet("relativeLocation"))
}

/// Adds the link of `kind` to `links`; false when the descriptors hold none of that kind.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
#[expect(
    dead_code,
    reason = "called by build_links until generate_api is ported, brief 2"
)]
pub(crate) fn add_link(
    _links: &mut LinkSet,
    _kind: LinkKind,
    _descriptors: DescriptorSet,
    _location: LinkLocation,
) -> Result<bool, GenerateError> {
    Err(not_ported_yet("addLink"))
}
