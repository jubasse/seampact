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

/// A consumer's needs, one per consumed kind, in the order the target declares them: the order
/// the refusals list the kinds in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct LinkNeeds(&'static [(LinkKind, LinkNeed)]);

impl LinkNeeds {
    /// No consumed kind.
    pub const NONE: Self = Self(&[]);

    /// The needs `declared`, each kind at most once.
    #[must_use]
    pub const fn new(declared: &'static [(LinkKind, LinkNeed)]) -> Self {
        Self(declared)
    }

    /// The need of `kind`, if the target consumes it.
    #[must_use]
    pub fn of(&self, kind: LinkKind) -> Option<&LinkNeed> {
        self.0
            .iter()
            .find(|(declared, _)| *declared == kind)
            .map(|(_, need)| need)
    }

    /// The consumed kinds, in declaration order.
    #[must_use]
    pub fn kinds(&self) -> Vec<LinkKind> {
        self.0.iter().map(|(kind, _)| *kind).collect()
    }
}

/// What a provider offers, one style per provided kind, in the order the target declares them:
/// the order the refusals list the kinds in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct LinkOffers(&'static [(LinkKind, LinkStyle)]);

impl LinkOffers {
    /// No provided kind.
    pub const NONE: Self = Self(&[]);

    /// The offers `declared`, each kind at most once.
    #[must_use]
    pub const fn new(declared: &'static [(LinkKind, LinkStyle)]) -> Self {
        Self(declared)
    }

    /// The style offered for `kind`, if the target provides it.
    #[must_use]
    pub fn of(&self, kind: LinkKind) -> Option<LinkStyle> {
        self.0
            .iter()
            .find(|(declared, _)| *declared == kind)
            .map(|(_, style)| *style)
    }

    /// The provided kinds, in declaration order.
    #[must_use]
    pub fn kinds(&self) -> Vec<LinkKind> {
        self.0.iter().map(|(kind, _)| *kind).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    const NEED: LinkNeed = LinkNeed {
        styles: NeedStyles::FromCompatibility,
        optional: None,
    };

    #[test]
    fn needs_list_their_kinds_in_declaration_order() {
        let needs = LinkNeeds::new(&[(LinkKind::Client, NEED), (LinkKind::Types, NEED)]);

        assert_eq!(needs.kinds(), [LinkKind::Client, LinkKind::Types]);
        assert!(needs.of(LinkKind::Types).is_some());
        assert!(needs.of(LinkKind::Validators).is_none());
        assert_eq!(LinkNeeds::NONE.kinds(), []);
    }

    #[test]
    fn offers_list_their_kinds_in_declaration_order() {
        let offers = LinkOffers::new(&[
            (LinkKind::Types, LinkStyle::Typescript),
            (LinkKind::Validators, LinkStyle::StandardSchema),
        ]);

        assert_eq!(offers.kinds(), [LinkKind::Types, LinkKind::Validators]);
        assert_eq!(offers.of(LinkKind::Types), Some(LinkStyle::Typescript));
        assert_eq!(offers.of(LinkKind::Client), None);
    }
}
