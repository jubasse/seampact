//! The checks on the paths a target generates: unsafe, duplicate and reserved paths.

use seampact_js::cmp_utf16;
use seampact_paths::{OutputPathSet, RelativeOutputPath};
use seampact_target::{GeneratedFile, Refusal, Refused, refusal_code};

/// The file in each output directory that lists what the writer wrote there.
pub const MANIFEST_FILE_NAME: &str = ".seampact-manifest.json";

const CASE_AWARE_FIX: &str = "Report this to the target's maintainers, or, if two paths differ only by letter case, rename one of the two contract names: a target emits distinct relative POSIX paths inside its output root.";

/// Refuses each unsafe, duplicate or reserved path, else answers the files in UTF-16 order of path.
///
/// # Errors
///
/// One `file.path.invalid` refusal per refused path.
pub fn check_generated_paths(mut files: Vec<GeneratedFile>) -> Result<Vec<GeneratedFile>, Refused> {
    let mut refusals: Vec<Refusal> = Vec::new();
    let mut seen = OutputPathSet::new();

    for file in &files {
        let reason = match RelativeOutputPath::try_new(file.path.as_str()) {
            Err(unsafe_path) => Some(unsafe_path.reason().as_str().to_owned()),
            Ok(path) => remembered_path_problem(&path, &mut seen),
        };

        if let Some(reason) = reason {
            refusals.push(Refusal::new(
                refusal_code::FILE_PATH_INVALID,
                format!(
                    "The target generated the path '{}', and {reason}.",
                    file.path
                ),
                CASE_AWARE_FIX,
            ));
        }
    }

    if !refusals.is_empty() {
        return Err(Refused(refusals));
    }

    files.sort_by(|left, right| cmp_utf16(&left.path, &right.path));

    Ok(files)
}

/// Adds the path to `seen`, then names why it is refused: a clash first, else the manifest name.
fn remembered_path_problem(path: &RelativeOutputPath, seen: &mut OutputPathSet) -> Option<String> {
    if let Some(clash) = seen.insert(path) {
        return Some(clash.to_string());
    }

    if path.file_name() == MANIFEST_FILE_NAME {
        return Some(format!("'{MANIFEST_FILE_NAME}' is the writer's manifest"));
    }

    None
}
