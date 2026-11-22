//! `seampact init`: the refusal a new project meets when its files exist.

use camino::Utf8PathBuf;
use seampact_cli_config::CliProblem;

use crate::CliIo;
use crate::cli_problem::unlocated_problem;
use crate::config_location::display_path;

/// The refusal when `existing` files already stand where a new project goes.
pub(crate) fn file_exists_problem(io: &dyn CliIo, existing: &[Utf8PathBuf]) -> CliProblem {
    let names: Vec<String> = existing
        .iter()
        .map(|path| display_path(io.cwd(), path))
        .collect();
    let verb = if existing.len() == 1 {
        "already exists"
    } else {
        "already exist"
    };

    unlocated_problem(
        "init.file-exists",
        format!(
            "`seampact init` writes a new project here, and {} {verb}; nothing was written.",
            names.join(" and ")
        ),
        "Run `seampact init` in a folder without them, or run `seampact init --modelines` to add the modelines to the contracts of an existing app config.",
    )
}
