//! The base paths two entries of an exclusive-routing target must not both serve.

use seampact_cli_config::{CliProblem, Step};
use seampact_target::{BasePathRouting, NO_MOUNT};

use crate::GenerateError;
use crate::mounted_base_paths::mounted_base_paths;
use crate::not_ported::not_ported_yet;
use crate::planned_entry::PlannedEntry;

/// One api an exclusive-routing entry serves, with the base paths it mounts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServedApi {
    /// The entry id.
    pub(crate) entry_id: String,
    /// The api id.
    pub(crate) api: String,
    /// The mounted base paths.
    pub(crate) base_paths: Vec<String>,
}

/// One problem for each pair of served apis, of exclusive-routing targets, whose base paths overlap.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] when two apis are served, until `sharedBasePathProblems` is ported.
pub fn exclusive_base_path_problems(planned: &[&PlannedEntry]) -> Result<Step<()>, GenerateError> {
    let mut served: Vec<ServedApi> = Vec::new();

    for entry in planned
        .iter()
        .filter(|each| each.target.metadata().base_paths == BasePathRouting::Exclusive)
    {
        let mount = entry.entry.settings.mount.as_deref().unwrap_or(NO_MOUNT);

        for api in &entry.apis {
            served.push(ServedApi {
                entry_id: entry.entry.settings.id.clone(),
                api: api.api.clone(),
                base_paths: mounted_base_paths(&api.ir, mount),
            });
        }
    }

    let mut problems = Vec::new();

    for (index, first) in served.iter().enumerate() {
        for second in served.iter().skip(index + 1) {
            problems.extend(shared_base_path_problems(first, second)?);
        }
    }

    if problems.is_empty() {
        Ok(Step::Done(()))
    } else {
        Ok(Step::Refused(problems))
    }
}

fn shared_base_path_problems(
    _first: &ServedApi,
    _second: &ServedApi,
) -> Result<Vec<CliProblem>, GenerateError> {
    Err(not_ported_yet("sharedBasePathProblems"))
}
