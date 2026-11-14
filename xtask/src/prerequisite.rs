//! What the TypeScript side of the gate needs installed before its steps can mean anything.

use camino::Utf8Path;

/// The directory `pnpm install` fills; the trace check and the oracle run TypeScript from it.
const NODE_MODULES: &str = "node_modules";

/// What to tell the user when `pnpm install` has not run, `None` when it has.
pub fn missing_node_modules_problem(workspace_root: &Utf8Path) -> Option<String> {
    if workspace_root.join(NODE_MODULES).is_dir() {
        return None;
    }

    Some(format!(
        "{NODE_MODULES} is missing: run pnpm install --frozen-lockfile first"
    ))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use camino::Utf8PathBuf;

    use super::*;

    fn scratch_workspace(name: &str, with_node_modules: bool) -> Utf8PathBuf {
        let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("xtask-prerequisite-{name}-{}", std::process::id()));

        fs::create_dir_all(&directory).unwrap();

        if with_node_modules {
            fs::create_dir_all(directory.join(NODE_MODULES)).unwrap();
        }

        directory
    }

    #[test]
    fn a_workspace_without_node_modules_is_told_to_install() {
        let workspace = scratch_workspace("missing", false);

        let problem = missing_node_modules_problem(&workspace);

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(
            problem.as_deref(),
            Some("node_modules is missing: run pnpm install --frozen-lockfile first")
        );
    }

    #[test]
    fn a_workspace_with_node_modules_has_nothing_to_install() {
        let workspace = scratch_workspace("present", true);

        let problem = missing_node_modules_problem(&workspace);

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(problem, None);
    }
}
