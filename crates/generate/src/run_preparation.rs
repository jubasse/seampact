//! The preparation of a run of generate or check: the config read, each app planned and
//! generated in memory, and every write checked before the first one.

use camino::Utf8Path;
use seampact_cli_config::{CliIo, Step};
use seampact_target::Registry;
use seampact_writer::HandEditPolicy;

use crate::not_ported::not_ported_yet;
use crate::{GenerateError, LocalBundles, PlannedWrites};

/// The app or root config a run reads: its file, the name problems give it, and the file its
/// text is read from when a host hands it over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunConfigLocation<'run> {
    /// The config file.
    pub file: &'run Utf8Path,
    /// The name problems give it.
    pub display_name: &'run str,
    /// The file its text is read from, when it is not `file`.
    pub text_file: Option<&'run Utf8Path>,
}

/// What a run takes besides the config: the bundles its host already fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanInputs<'run> {
    /// The bundle directory of each source, never fetched.
    pub local_bundles: &'run LocalBundles,
}

/// Reads the config, plans and generates every app with the generators of `registry`, and checks
/// every write under `policy`; nothing is written.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn prepare_run(
    _location: &RunConfigLocation<'_>,
    _io: &mut dyn CliIo,
    _policy: HandEditPolicy,
    _inputs: &PlanInputs<'_>,
    _registry: &Registry,
) -> Result<Step<PlannedWrites>, GenerateError> {
    Err(not_ported_yet("prepareRun"))
}
