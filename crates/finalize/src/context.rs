//! What finalize reads besides the draft, and where it reports.

use indexmap::IndexMap;
use seampact_authoring::RawApi;
use seampact_diagnostics::Diagnostic;
use seampact_span::Location;

/// The package name and the path inside the package of a pack file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackFileParts<'file> {
    /// The package name (`@acme/pack-a`).
    pub name: &'file str,
    /// The path inside the package.
    pub inside: &'file str,
}

/// How the side table names a file: the load stage owns the pack file paths, which this crate
/// does not depend on, so the caller supplies them.
pub trait PackFiles {
    /// The package and the path inside it of a pack file, `None` for a file in no pack package.
    fn parts<'file>(&self, file: &'file str) -> Option<PackFileParts<'file>>;

    /// The pack file as the bundle vendors it: `.packs/<name>@<version>/<inside>`.
    fn vendored_file(&self, name: &str, version: &str, inside: &str) -> String;

    /// Whether `file` is inside the workspace root (no `..` segment leaves it).
    fn is_inside_workspace(&self, file: &str) -> bool;
}

/// The context of one api's finalize: the loaded api, its locations, and the diagnostics it reports.
///
/// It lives for one call of [`finalize`](crate::finalize).
pub struct FinalizeContext<'run> {
    pub(crate) raw: &'run RawApi,
    pub(crate) locations: &'run IndexMap<String, Location>,
    pub(crate) pack_files: &'run dyn PackFiles,
    diagnostics: Vec<Diagnostic>,
}

impl<'run> FinalizeContext<'run> {
    /// A context for `raw`, whose side table `locations` already holds each span as a location.
    #[must_use]
    pub fn new(
        raw: &'run RawApi,
        locations: &'run IndexMap<String, Location>,
        pack_files: &'run dyn PackFiles,
    ) -> Self {
        Self {
            raw,
            locations,
            pack_files,
            diagnostics: Vec::new(),
        }
    }

    /// Reports `diagnostic`.
    pub fn report(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }

    /// The diagnostics reported, in order.
    #[must_use]
    pub fn into_diagnostics(self) -> Vec<Diagnostic> {
        self.diagnostics
    }
}
