//! The base paths two entries of an exclusive-routing target must not both serve.

use seampact_cli_config::{CliProblem, Problems, entry_where, located_problem};
use seampact_target::{BasePathRouting, NO_MOUNT};

use crate::mounted_base_paths::mounted_base_paths;
use crate::planned_entry::PlannedEntry;
use crate::stop::Stop;

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
/// [`Stop::Refused`] with the overlaps.
pub fn exclusive_base_path_problems(planned: &[&PlannedEntry]) -> Result<(), Stop> {
    let mut served: Vec<ServedApi> = Vec::new();

    for entry in planned
        .iter()
        .filter(|each| each.target.metadata().base_paths == BasePathRouting::Exclusive)
    {
        let mount = entry.settings.mount.as_deref().unwrap_or(NO_MOUNT);

        for api in &entry.apis {
            served.push(ServedApi {
                entry_id: entry.settings.id.clone(),
                api: api.api.clone(),
                base_paths: mounted_base_paths(&api.ir, mount),
            });
        }
    }

    let mut problems = Vec::new();

    for (index, first) in served.iter().enumerate() {
        for second in served.iter().skip(index + 1) {
            problems.extend(shared_base_path_problems(first, second));
        }
    }

    Ok(Problems::refuse_any(problems)?)
}

fn shared_base_path_problems(first: &ServedApi, second: &ServedApi) -> Vec<CliProblem> {
    first
        .base_paths
        .iter()
        .flat_map(|first_path| {
            second
                .base_paths
                .iter()
                .filter(|second_path| overlaps(first_path, second_path))
                .map(move |second_path| {
                    shared_base_path_problem(first, first_path, second, second_path)
                })
        })
        .collect()
}

/// Whether two base paths are equal or one contains the other; an empty path overlaps nothing.
fn overlaps(first_path: &str, second_path: &str) -> bool {
    if first_path.is_empty() || second_path.is_empty() {
        return false;
    }

    first_path == second_path
        || first_path.starts_with(&format!("{second_path}/"))
        || second_path.starts_with(&format!("{first_path}/"))
}

fn shared_base_path_problem(
    first: &ServedApi,
    first_path: &str,
    second: &ServedApi,
    second_path: &str,
) -> CliProblem {
    located_problem(
        "path.base.shared.unsupported",
        format!(
            "The api '{}' of entry '{}' is served under '{first_path}' and the api '{}' of entry '{}' under '{second_path}': the more specific route would take the other api's paths.",
            first.api, first.entry_id, second.api, second.entry_id
        ),
        "Give the two apis base paths that neither equal nor contain each other, through their prefixes or the entries' 'mount'.",
        entry_where(&second.entry_id, Some(&second.api)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_paths_overlap_when_equal_or_nested_on_a_segment() {
        for (first, second, overlapping) in [
            ("/a", "/a", true),
            ("/a", "/a/b", true),
            ("/a/b", "/a", true),
            ("/a", "/ab", false),
            ("/a", "/b", false),
            ("", "/a", false),
            ("/a", "", false),
            ("", "", false),
        ] {
            assert_eq!(overlaps(first, second), overlapping, "{first:?} {second:?}");
        }
    }
}
