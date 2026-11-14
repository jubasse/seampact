//! The identities this half builds are credential or signed ones: the open `Unknown` variant of
//! the IR never comes out of its own catalogue, and reading one is a bug.

use seampact_diagnostics::InternalError;
use seampact_ir::{CredentialIdentity, Identity, IdentityId, Origin, Principal, SignedIdentity};

/// An identity of the catalogue this half built.
#[derive(Debug, Clone, Copy)]
pub(crate) enum KnownIdentity<'built> {
    Credential(&'built CredentialIdentity),
    Signed(&'built SignedIdentity),
}

impl<'built> KnownIdentity<'built> {
    /// The known form of a catalogue identity.
    ///
    /// # Errors
    ///
    /// An internal error for an identity of a kind this compiler does not know.
    pub(crate) fn of(identity: &'built Identity) -> Result<Self, InternalError> {
        match identity {
            Identity::Credential(credential) => Ok(Self::Credential(credential)),
            Identity::Signed(signed) => Ok(Self::Signed(signed)),
            Identity::Unknown(unknown) => Err(InternalError::new(format!(
                "access.identity built an identity of unknown kind '{}'",
                unknown.tag()
            ))),
        }
    }

    pub(crate) const fn id(self) -> &'built IdentityId {
        match self {
            Self::Credential(identity) => &identity.id,
            Self::Signed(identity) => &identity.id,
        }
    }

    pub(crate) const fn principal(self) -> &'built Principal {
        match self {
            Self::Credential(identity) => &identity.principal,
            Self::Signed(identity) => &identity.principal,
        }
    }

    pub(crate) const fn origin(self) -> &'built Origin {
        match self {
            Self::Credential(identity) => &identity.origin,
            Self::Signed(identity) => &identity.origin,
        }
    }
}
