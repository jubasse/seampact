//! What a consumer needs and a provider offers, and the links the run planning passes.

use serde::{Deserialize, Serialize};

use crate::{Descriptor, LinkKind, LinkStyle};

/// What a target generates itself when an optional link is not given, such as `ajv`, named in the
/// refusal of a link of a style the target does not read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OptionalNeed {
    /// The library the target's own output uses.
    pub own_library: &'static str,
}

/// Where the accepted styles of a need come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NeedStyles {
    /// The styles the target lists.
    Listed(&'static [LinkStyle]),
    /// The styles the compatibility data records for the target's [`crate::CompatibilityKey`].
    FromCompatibility,
}

/// One consumed kind: its accepted styles, and whether the link may be absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LinkNeed {
    /// The accepted styles.
    pub styles: NeedStyles,
    /// Set when the kind may have no link.
    pub optional: Option<OptionalNeed>,
}

/// A consumer's needs, one optional field per kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct LinkNeeds {
    /// The validators need.
    pub validators: Option<LinkNeed>,
    /// The types need.
    pub types: Option<LinkNeed>,
    /// The client need.
    pub client: Option<LinkNeed>,
}

impl LinkNeeds {
    /// No consumed kind.
    pub const NONE: Self = Self {
        validators: None,
        types: None,
        client: None,
    };

    /// The need of `kind`, if the target consumes it.
    #[must_use]
    pub const fn of(&self, kind: LinkKind) -> Option<&LinkNeed> {
        match kind {
            LinkKind::Validators => self.validators.as_ref(),
            LinkKind::Types => self.types.as_ref(),
            LinkKind::Client => self.client.as_ref(),
        }
    }
}

/// What a provider offers, one optional style per kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct LinkOffers {
    /// The validators style offered.
    pub validators: Option<LinkStyle>,
    /// The types style offered.
    pub types: Option<LinkStyle>,
    /// The client style offered.
    pub client: Option<LinkStyle>,
}

impl LinkOffers {
    /// No provided kind.
    pub const NONE: Self = Self {
        validators: None,
        types: None,
        client: None,
    };

    /// The style offered for `kind`, if the target provides it.
    #[must_use]
    pub const fn of(&self, kind: LinkKind) -> Option<LinkStyle> {
        match kind {
            LinkKind::Validators => self.validators,
            LinkKind::Types => self.types,
            LinkKind::Client => self.client,
        }
    }

    /// The provided kinds, in [`LinkKind::ALL`] order.
    #[must_use]
    pub fn kinds(&self) -> Vec<LinkKind> {
        LinkKind::ALL
            .into_iter()
            .filter(|kind| self.of(*kind).is_some())
            .collect()
    }
}

/// One need with its styles read: what the link check and a generator compare links with.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResolvedLinkNeed {
    /// The accepted styles, in the order listed or recorded.
    pub styles: Vec<LinkStyle>,
    /// The first-party packages writing each accepted style, in style order, for the refusals.
    pub providers: Vec<String>,
    /// Set when the kind may have no link.
    pub optional: Option<OptionalNeed>,
}

/// A target's needs with every style read, built by the run planning once per entry.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct ResolvedLinkNeeds {
    /// The validators need.
    pub validators: Option<ResolvedLinkNeed>,
    /// The types need.
    pub types: Option<ResolvedLinkNeed>,
    /// The client need.
    pub client: Option<ResolvedLinkNeed>,
}

impl ResolvedLinkNeeds {
    /// No consumed kind.
    pub const NONE: Self = Self {
        validators: None,
        types: None,
        client: None,
    };

    /// The need of `kind`, if the target consumes it.
    #[must_use]
    pub const fn of(&self, kind: LinkKind) -> Option<&ResolvedLinkNeed> {
        match kind {
            LinkKind::Validators => self.validators.as_ref(),
            LinkKind::Types => self.types.as_ref(),
            LinkKind::Client => self.client.as_ref(),
        }
    }
}

/// Where the provider's output root is, seen from the consumer (ADR 0009, ADR 0011).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LinkLocation {
    /// A POSIX path relative to the consumer's output root.
    Relative {
        /// The path.
        path: String,
    },
    /// The module specifier the app config gives when the outputs live in different packages.
    Module {
        /// The specifier.
        specifier: String,
    },
}

/// A provider's descriptor and where its output is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    /// What the provider wrote.
    pub descriptor: Descriptor,
    /// Where it is.
    pub location: LinkLocation,
}

/// The links the run planning passes, one optional field per kind, as the app config's `link`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkSet {
    /// The client link; the fields are in key order, as the probes echo them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<Link>,
    /// The types link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Link>,
    /// The validators link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validators: Option<Link>,
}

impl LinkSet {
    /// No link.
    pub const NONE: Self = Self {
        client: None,
        types: None,
        validators: None,
    };

    /// The link of `kind`, if given.
    #[must_use]
    pub const fn of(&self, kind: LinkKind) -> Option<&Link> {
        match kind {
            LinkKind::Validators => self.validators.as_ref(),
            LinkKind::Types => self.types.as_ref(),
            LinkKind::Client => self.client.as_ref(),
        }
    }

    /// Sets the link of `kind`.
    pub fn insert(&mut self, kind: LinkKind, link: Link) {
        let slot = match kind {
            LinkKind::Validators => &mut self.validators,
            LinkKind::Types => &mut self.types,
            LinkKind::Client => &mut self.client,
        };

        *slot = Some(link);
    }
}
