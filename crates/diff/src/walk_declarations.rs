//! The declaration catalogues (errors, natures, schemes, headers, identities, rights, rules, scopes,
//! buckets, services, extension keys, formats and paging styles) the walk compares entry by entry.

use crate::DiffError;
use crate::not_ported::not_ported_yet;
use crate::walk_context::WalkContext;

/// A declaration catalogue of the IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum DeclarationCatalogue {
    Errors,
    Natures,
    Schemes,
    Headers,
    Identities,
    Rights,
    Rules,
    Scopes,
    Buckets,
    Services,
    ExtensionKeys,
    Formats,
    Pagings,
}

impl DeclarationCatalogue {
    /// Every catalogue, in the order the TypeScript lists them.
    pub(crate) const ALL: [Self; 13] = [
        Self::Errors,
        Self::Natures,
        Self::Schemes,
        Self::Headers,
        Self::Identities,
        Self::Rights,
        Self::Rules,
        Self::Scopes,
        Self::Buckets,
        Self::Services,
        Self::ExtensionKeys,
        Self::Formats,
        Self::Pagings,
    ];

    /// The IR member holding the catalogue.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Errors => "errors",
            Self::Natures => "natures",
            Self::Schemes => "schemes",
            Self::Headers => "headers",
            Self::Identities => "identities",
            Self::Rights => "rights",
            Self::Rules => "rules",
            Self::Scopes => "scopes",
            Self::Buckets => "buckets",
            Self::Services => "services",
            Self::ExtensionKeys => "extensionKeys",
            Self::Formats => "formats",
            Self::Pagings => "pagings",
        }
    }

    /// The catalogue named `name`, if it is one.
    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|catalogue| catalogue.as_str() == name)
    }
}

/// Compares the entries of one catalogue.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_declarations(
    _context: &mut WalkContext<'_>,
    _catalogue: DeclarationCatalogue,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareDeclarations"))
}
