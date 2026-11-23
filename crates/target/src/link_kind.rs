//! The kinds of link a provider offers and a consumer reads, and their styles.

use serde::{Deserialize, Serialize};

/// What a link carries: one descriptor per kind (`descriptors.ts#DescriptorByKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    /// Standard Schema or class-validator validators.
    Validators,
    /// TypeScript types.
    Types,
    /// A fetch client.
    Client,
}

impl LinkKind {
    /// Every kind, in the order the TypeScript declares them.
    pub const ALL: [Self; 3] = [Self::Validators, Self::Types, Self::Client];

    /// The kind as the app config's `link` keys and the descriptors write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Validators => "validators",
            Self::Types => "types",
            Self::Client => "client",
        }
    }
}

/// The form a provider writes for its kind (`LinkStyle`, `ProviderStyle` of the compatibility
/// data).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinkStyle {
    /// Validators as Standard Schema v1 values.
    StandardSchema,
    /// Validators as class-validator classes.
    ClassValidator,
    /// TypeScript types.
    Typescript,
    /// A client over `fetch`.
    Fetch,
}

impl LinkStyle {
    /// The style as the descriptors and the compatibility data write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StandardSchema => "standard-schema",
            Self::ClassValidator => "class-validator",
            Self::Typescript => "typescript",
            Self::Fetch => "fetch",
        }
    }

    /// The kind whose descriptor carries the style.
    #[must_use]
    pub const fn kind(self) -> LinkKind {
        match self {
            Self::StandardSchema | Self::ClassValidator => LinkKind::Validators,
            Self::Typescript => LinkKind::Types,
            Self::Fetch => LinkKind::Client,
        }
    }
}
