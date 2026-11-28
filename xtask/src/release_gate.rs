//! The gate step `release`: the release binary, built without the oracle feature, refuses a
//! config that uses a probe generator with `config.target.external` (generators.md section 2).

use std::fs;
use std::process::Command;

use camino::{Utf8Path, Utf8PathBuf};

use crate::outcome::{StepOutcome, StepReport};

/// The name of the step in the gate report.
pub const RELEASE_STEP: &str = "release";

/// The rule the release binary answers for a target it does not link.
const EXPECTED_RULE: &str = "config.target.external";

/// The exit code of a refusal.
const REFUSED_EXIT_CODE: i32 = 1;

const CONFIG: &str =
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: probe-server, api: tasks }\n";

const API: &str = "api:\n  name: tasks\n  version: 1\n  kind: product\n  maturity: provisional\n  summary: A small tasks api.\n";

/// Builds the release binary and runs `generate` on a config that uses `probe-server`.
pub fn release_gate_step(workspace_root: &Utf8Path) -> StepReport {
    match refusal_problem(workspace_root) {
        Ok(None) => StepReport {
            outcome: StepOutcome::Passed { step: RELEASE_STEP },
            stdout: String::new(),
            stderr: String::new(),
        },
        Ok(Some(problem)) | Err(problem) => StepReport::failed_with(RELEASE_STEP, &problem),
    }
}

/// What is wrong with the release binary's answer, `None` when it refuses as expected.
fn refusal_problem(workspace_root: &Utf8Path) -> Result<Option<String>, String> {
    let binary = build_release_binary(workspace_root)?;
    let project = scratch_project()?;
    let output = Command::new(binary.as_str())
        .arg("generate")
        .current_dir(&project)
        .output()
        .map_err(|error| format!("cannot start {binary}: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    fs::remove_dir_all(&project)
        .map_err(|error| format!("cannot remove the scratch project {project}: {error}"))?;

    if output.status.code() == Some(REFUSED_EXIT_CODE) && stderr.contains(EXPECTED_RULE) {
        return Ok(None);
    }

    Ok(Some(format!(
        "the release binary must refuse `use: probe-server` with {EXPECTED_RULE} and exit {REFUSED_EXIT_CODE}, got {:?}: {stderr}",
        output.status.code()
    )))
}

/// Builds `seampact` in release mode with the default features and answers its path.
fn build_release_binary(workspace_root: &Utf8Path) -> Result<Utf8PathBuf, String> {
    let status = Command::new("cargo")
        .args([
            "build",
            "--release",
            "--quiet",
            "--package",
            "seampact-cli",
            "--bin",
            "seampact",
        ])
        .current_dir(workspace_root)
        .status()
        .map_err(|error| format!("cannot start cargo: {error}"))?;

    if !status.success() {
        return Err("the release build of seampact-cli failed".to_owned());
    }

    let target = std::env::var("CARGO_TARGET_DIR")
        .map_or_else(|_| workspace_root.join("target"), Utf8PathBuf::from);

    Ok(target.join("release").join("seampact"))
}

/// A directory holding a config with a probe target and one api, unique to this process.
fn scratch_project() -> Result<Utf8PathBuf, String> {
    let project = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .map_err(|path| format!("the temporary directory {} is not UTF-8", path.display()))?
        .join(format!("xtask-release-{}", std::process::id()));

    fs::create_dir_all(project.join("a"))
        .map_err(|error| format!("cannot create {project}: {error}"))?;
    fs::write(project.join("seampact.config.yaml"), CONFIG)
        .map_err(|error| format!("cannot write the config in {project}: {error}"))?;
    fs::write(project.join("a").join("api.yaml"), API)
        .map_err(|error| format!("cannot write the api in {project}: {error}"))?;

    Ok(project)
}
