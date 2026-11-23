//! The gate step `deps`: the dependency direction of the generator crates, as allow lists over
//! `cargo tree -e normal` (generators.md section 3).

use std::collections::BTreeSet;
use std::process::Command;

use camino::Utf8Path;

use crate::outcome::{StepOutcome, StepReport};

/// The name of the step in the gate report.
pub const DEPS_STEP: &str = "deps";

/// The prefix of every workspace crate.
const WORKSPACE_PREFIX: &str = "seampact-";

/// The directory prefix of a family library crate.
const FAMILY_PREFIX: &str = "family-";

/// The directory prefix of a target crate.
const TARGET_PREFIX: &str = "gen-";

/// What a family library or a target crate may reach, with everything those reach.
const GENERATOR_BASE_CRATES: [&str; 6] = [
    "seampact-target",
    "seampact-ir",
    "seampact-json",
    "seampact-js",
    "seampact-naming",
    "seampact-plan",
];

/// A crate that must not reach another with its default features, as the release binary builds
/// it, whatever the allow lists say.
struct ForbiddenEdge {
    from: &'static str,
    to: &'static str,
}

const FORBIDDEN_EDGES: [ForbiddenEdge; 3] = [
    ForbiddenEdge {
        from: "seampact-generate",
        to: "seampact-generators",
    },
    ForbiddenEdge {
        from: "seampact-cli-config",
        to: "seampact-compiler",
    },
    ForbiddenEdge {
        from: "seampact-cli",
        to: "seampact-gen-probe",
    },
];

/// Runs the step: every problem on its own line, the step failed when there is one.
pub fn deps_gate_step(workspace_root: &Utf8Path) -> StepReport {
    match dependency_problems(workspace_root) {
        Ok(problems) if problems.is_empty() => StepReport {
            outcome: StepOutcome::Passed { step: DEPS_STEP },
            stdout: String::new(),
            stderr: String::new(),
        },
        Ok(problems) => StepReport {
            outcome: StepOutcome::Failed { step: DEPS_STEP },
            stdout: String::new(),
            stderr: problems.join("\n") + "\n",
        },
        Err(problem) => StepReport::failed_with(DEPS_STEP, &problem),
    }
}

fn dependency_problems(workspace_root: &Utf8Path) -> Result<Vec<String>, String> {
    let mut problems = Vec::new();
    let generator_crates = generator_crates(workspace_root)?;
    let workspace_crates = workspace_crates(workspace_root)?;
    let base_crates: Vec<&str> = GENERATOR_BASE_CRATES
        .into_iter()
        .filter(|name| workspace_crates.contains(*name))
        .collect();
    let base_closure = reached_crates(workspace_root, &base_crates)?;

    for crate_name in &generator_crates {
        let reached = reached_crates(workspace_root, &[crate_name.as_str()])?;

        for dependency in reached
            .iter()
            .filter(|dependency| *dependency != crate_name)
        {
            let is_family = dependency.starts_with(&format!("{WORKSPACE_PREFIX}{FAMILY_PREFIX}"));
            // A family library may sit under a target or another library; a target under nothing.
            let is_allowed = base_closure.contains(dependency) || is_family;

            if !is_allowed {
                problems.push(format!(
                    "{crate_name} reaches {dependency}, which its allow list does not name"
                ));
            }
        }
    }

    for edge in &FORBIDDEN_EDGES {
        let reached = reached_crates(workspace_root, &[edge.from])?;

        if reached.contains(edge.to) {
            problems.push(format!("{} reaches {}", edge.from, edge.to));
        }
    }

    Ok(problems)
}

/// The packages of the `family-*` and `gen-*` directories of `crates/`.
fn generator_crates(workspace_root: &Utf8Path) -> Result<Vec<String>, String> {
    let crates_directory = workspace_root.join("crates");
    let entries = crates_directory
        .read_dir_utf8()
        .map_err(|error| format!("{DEPS_STEP}: cannot list {crates_directory}: {error}"))?;
    let mut names = Vec::new();

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("{DEPS_STEP}: cannot list {crates_directory}: {error}"))?;
        let directory = entry.file_name();

        if directory.starts_with(FAMILY_PREFIX) || directory.starts_with(TARGET_PREFIX) {
            names.push(format!("{WORKSPACE_PREFIX}{directory}"));
        }
    }

    names.sort();

    Ok(names)
}

/// The workspace crates, so a base crate not built yet (`seampact-plan`) is left out.
fn workspace_crates(workspace_root: &Utf8Path) -> Result<BTreeSet<String>, String> {
    let crates_directory = workspace_root.join("crates");
    let entries = crates_directory
        .read_dir_utf8()
        .map_err(|error| format!("{DEPS_STEP}: cannot list {crates_directory}: {error}"))?;

    entries
        .map(|entry| {
            entry
                .map(|entry| format!("{WORKSPACE_PREFIX}{}", entry.file_name()))
                .map_err(|error| format!("{DEPS_STEP}: cannot list {crates_directory}: {error}"))
        })
        .collect()
}

/// The workspace crates `packages` reach through normal dependencies, the packages included.
fn reached_crates(
    workspace_root: &Utf8Path,
    packages: &[&str],
) -> Result<BTreeSet<String>, String> {
    let mut command = Command::new("cargo");

    command
        .args([
            "tree", "--edges", "normal", "--prefix", "none", "--format", "{p}",
        ])
        .current_dir(workspace_root);

    for package in packages {
        command.args(["--package", package]);
    }

    let output = command
        .output()
        .map_err(|error| format!("{DEPS_STEP}: cannot start cargo tree: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "{DEPS_STEP}: cargo tree of {} failed: {}",
            packages.join(", "),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .filter(|name| name.starts_with(WORKSPACE_PREFIX))
        .map(str::to_owned)
        .collect())
}
