//! The check of an app's entries against the compatibility matrix: the installed framework and
//! library versions each target was tested on.

use indexmap::IndexMap;
use seampact_target::{CompatibilityMatrix, Generator};

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem, LoadedAppConfig};

/// What the check finds: problems at the `error` level of `checks.matrix`, warnings otherwise.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompatibilityOutcome {
    /// What fails the run.
    pub problems: Vec<CliProblem>,
    /// What the run reports and goes on.
    pub warnings: Vec<CliProblem>,
}

/// Reads each entry's installed framework version from its output directory, where the generated
/// code resolves its imports, then checks the app against `matrix`; `targets` is the resolved
/// generator of each entry, by entry id.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn check_app_compatibility(
    _config: &LoadedAppConfig,
    _targets: &IndexMap<String, &'static dyn Generator>,
    _matrix: &CompatibilityMatrix,
) -> Result<CompatibilityOutcome, CliConfigError> {
    Err(not_ported_yet("checkAppCompatibility"))
}
