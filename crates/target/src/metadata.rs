//! What a generator declares about itself: id, role, IR support, artefacts, links, checks.

use std::fmt;

use seampact_ir::IrSupport;

use crate::{
    ArtefactDeclaration, CompatibilityKey, ImportSpecifierStyle, LinkNeeds, LinkOffers,
    TunableBootCheck,
};

/// The version every generator of this binary reports, the package version of the TypeScript.
pub const GENERATOR_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A target's short id, the same in every ecosystem (ADR 0031 "Target ids").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TargetId(&'static str);

impl TargetId {
    /// The id `id`; a registry test checks every id is lowercase kebab-case.
    #[must_use]
    pub const fn new(id: &'static str) -> Self {
        Self(id)
    }

    /// The id as `use:` writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl fmt::Display for TargetId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

/// What a target is to the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TargetRole {
    /// Serves the contract.
    Server,
    /// Calls the contract.
    Client,
    /// Writes what other targets link to.
    Provider,
}

impl TargetRole {
    /// Every role, in the TypeScript's `TARGET_ROLES` order.
    pub const ALL: [Self; 3] = [Self::Server, Self::Client, Self::Provider];

    /// The role as the TypeScript writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Server => "server",
            Self::Client => "client",
            Self::Provider => "provider",
        }
    }
}

/// How a server routes the apis of one app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BasePathRouting {
    /// Several apis may share or nest base paths.
    Shared,
    /// Each api is routed by its base paths before the boundary runs, so two apis whose mounted
    /// base paths are equal or nested are refused (`exclusiveBasePaths`).
    Exclusive,
}

/// What a generator declares about itself; static, so the registry reads it without running
/// anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetMetadata {
    /// The short id.
    pub id: TargetId,
    /// The version the header and the IR support refusals name: [`GENERATOR_VERSION`] for a
    /// first-party generator; a probe keeps its TypeScript twin's.
    pub version: &'static str,
    /// The 1.x `use` strings of the target, refused with its short id.
    pub legacy_names: &'static [&'static str],
    /// The role.
    pub role: TargetRole,
    /// The IR the target reads.
    pub ir_support: IrSupport<'static>,
    /// The artefacts an app config can switch.
    pub artefacts: &'static [ArtefactDeclaration],
    /// The kinds the target consumes.
    pub consumes: LinkNeeds,
    /// The kinds the target provides.
    pub provides: LinkOffers,
    /// The boot checks an app config entry may tune.
    pub boot_checks: &'static [TunableBootCheck],
    /// The fix stated when the app config sets `frameworkDocs: off` for a target that knows no
    /// switch for its framework's own docs.
    pub framework_docs_off_fix: Option<&'static str>,
    /// How the relative imports of the target's files, and of its linked providers' files for it,
    /// name their modules; `js` when absent.
    pub import_specifiers: Option<ImportSpecifierStyle>,
    /// How the server routes the apis of one app.
    pub base_paths: BasePathRouting,
    /// The runtime packages whose installed versions the run planning reads for the target.
    pub runtime_packages: &'static [&'static str],
    /// The target's record in the compatibility data, when it has one.
    pub compatibility: Option<CompatibilityKey>,
}
