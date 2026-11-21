//! Why a bundle is refused, with the fix.

/// The code of a bundle failure.
///
/// Declared by the brief that ports `spec/src/bundle/failure.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleFailureCode {}

/// Why a bundle is refused, with the fix.
#[derive(Debug, Clone, PartialEq)]
pub struct BundleFailure {
    /// The `code` member.
    pub code: BundleFailureCode,
    /// The `message` member.
    pub message: String,
    /// The `fix` member.
    pub fix: String,
    /// The bundle path (or archive entry, or source file) the failure is about.
    pub file: Option<String>,
    /// What was expected (the manifest, the pin), when two values differ.
    pub expected: Option<String>,
    /// What was found, when two values differ.
    pub actual: Option<String>,
}
