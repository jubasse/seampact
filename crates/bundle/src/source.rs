//! Where an imported bundle comes from, as a workspace or a config names it.

/// Where an imported bundle comes from: a package, a git tag, a release or a maven coordinate.
///
/// Declared by the brief that ports `spec/src/bundle/source.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleSource {}
