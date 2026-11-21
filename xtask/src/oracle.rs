//! The oracle task: the harness of `seampact-oracle` run with the compiler subject, then the tool
//! runs with the CLI's tool subject.

use std::fmt;
use std::time::Duration;

use camino::Utf8Path;
use seampact_cli::oracle::CliToolSubject;
use seampact_compiler::oracle::CompilerSubject;
use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, Fixture, HalfInput, HalfOutput, OracleError, OracleSubject, RecordedCall,
    RuleIdRegistry, Selection, SubjectAnswer, Tool, ToolSelection, ToolVerdict, Verdict,
    run_oracle, run_tools,
};

use crate::outcome::{StepOutcome, StepReport};
use crate::prerequisite::missing_node_modules_problem;

const ORACLE_STEP: &str = "oracle";

/// The subject while no compiler crate is plugged in: every answer is not ported.
struct NothingPortedSubject;

impl OracleSubject for NothingPortedSubject {
    fn compile(&self, _fixture: &Fixture) -> SubjectAnswer<Compilation> {
        SubjectAnswer::NotPorted
    }

    fn run_half(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _half: &str,
        _input: &HalfInput<'_>,
        _calls: &[RecordedCall],
    ) -> SubjectAnswer<HalfOutput> {
        SubjectAnswer::NotPorted
    }

    fn replay_schema_calls(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _input: &HalfInput<'_>,
        _calls: &[RecordedCall],
    ) -> SubjectAnswer<Vec<Option<JsonValue>>> {
        SubjectAnswer::NotPorted
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

/// The manifest whose presence means a compiler crate exists and its subject must be plugged in.
const COMPILER_MANIFEST: &str = "crates/compiler/Cargo.toml";

/// The compiler the oracle checks: the one place a compiler crate plugs its subject in, `None`
/// until it does.
#[expect(
    clippy::unnecessary_wraps,
    reason = "the plug point stays an Option: the gate refuses a compiler crate with no subject"
)]
fn compiler_subject() -> Option<Box<dyn OracleSubject>> {
    Some(Box::new(CompilerSubject::default()))
}

/// Why the oracle cannot vouch for the workspace: a compiler crate exists and no subject is
/// plugged into [`compiler_subject`], so every fixture would pass as not ported.
fn unplugged_compiler_problem(
    workspace_root: &Utf8Path,
    plugged_subject: Option<&dyn OracleSubject>,
) -> Option<&'static str> {
    if plugged_subject.is_none() && workspace_root.join(COMPILER_MANIFEST).exists() {
        return Some(
            "compiler crate present but no subject plugged in: return it from compiler_subject in xtask/src/oracle.rs",
        );
    }

    None
}

/// The seconds one fixture may take unless `--time-limit` says otherwise.
const DEFAULT_FIXTURE_TIME_LIMIT: Duration = Duration::from_secs(120);

/// Names the fixture that passed the limit and ends the run: a subject that hangs never returns.
#[expect(
    clippy::exit,
    reason = "a subject that hangs never returns: the watcher thread can only end the process"
)]
fn stop_on_time_limit(fixture: &str, limit: Duration) {
    eprintln!(
        "{ORACLE_STEP}: fixture {fixture} ran past the {} s limit of one fixture: stopping",
        limit.as_secs()
    );

    std::process::exit(1);
}

/// Every fixture, every output, the default time limit.
pub fn default_selection() -> Selection {
    Selection {
        fixture_time_limit: Some(DEFAULT_FIXTURE_TIME_LIMIT),
        on_time_limit: Some(stop_on_time_limit),
        ..Selection::default()
    }
}

/// What one oracle task compares: the compiler's selection, and the one tool when `--tool` names
/// it (the compiler is then left out).
#[derive(Debug, Clone, Default)]
pub struct OracleRequest {
    /// The fixtures, the half and the time limit of the compiler run; the glob also selects the
    /// tool cases.
    pub selection: Selection,
    /// The one tool run alone.
    pub tool: Option<Tool>,
}

/// The verdicts of one oracle task: the compiler's when it ran, the tools' when they ran.
#[derive(Debug, Clone, Default)]
pub struct OracleOutcome {
    compiler: Option<Verdict>,
    tools: Option<ToolVerdict>,
}

impl OracleOutcome {
    /// Whether every verdict passes.
    pub fn passed(&self) -> bool {
        self.compiler.as_ref().is_none_or(Verdict::passed)
            && self.tools.as_ref().is_none_or(ToolVerdict::passed)
    }
}

impl fmt::Display for OracleOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let verdicts: Vec<String> = [
            self.compiler.as_ref().map(ToString::to_string),
            self.tools.as_ref().map(ToString::to_string),
        ]
        .into_iter()
        .flatten()
        .collect();

        write!(formatter, "{}", verdicts.join("\n"))
    }
}

/// Runs the oracle on `request` and gives its verdicts: the compiler, then every tool; one tool
/// alone with `--tool`; the compiler alone with `--half`.
///
/// # Errors
///
/// A usage error when the selection matches nothing; otherwise when a repository file cannot be
/// read or is invalid.
pub fn run_oracle_task(
    workspace_root: &Utf8Path,
    request: &OracleRequest,
) -> Result<OracleOutcome, OracleError> {
    let tool_selection = ToolSelection {
        tool: request.tool,
        case_glob: request.selection.fixture_glob.clone(),
    };

    if request.tool.is_some() {
        let tools = run_tools(workspace_root, &tool_selection, &CliToolSubject)?;

        refuse_empty_tool_run(&tools)?;

        return Ok(OracleOutcome {
            compiler: None,
            tools: Some(tools),
        });
    }

    let compiler = match compiler_subject() {
        Some(subject) => run_oracle(workspace_root, &request.selection, &*subject),
        None => run_oracle(workspace_root, &request.selection, &NothingPortedSubject),
    };

    if request.selection.half.is_some() {
        return Ok(OracleOutcome {
            compiler: Some(compiler?),
            tools: None,
        });
    }

    let tools = run_tools(workspace_root, &tool_selection, &CliToolSubject)?;

    // A glob may select tool cases only: the compiler's usage error stands when it selects none.
    let compiler = match compiler {
        Ok(verdict) => Some(verdict),
        Err(error) if error.is_usage() && tools.cases() > 0 => None,
        Err(error) => return Err(error),
    };

    Ok(OracleOutcome {
        compiler,
        tools: Some(tools),
    })
}

fn refuse_empty_tool_run(tools: &ToolVerdict) -> Result<(), OracleError> {
    if tools.cases() > 0 {
        return Ok(());
    }

    Err(OracleError::Usage {
        problem: "the glob matches no case of the tool".to_owned(),
    })
}

/// The oracle step of the gate: every fixture, the verdict kept in the report, then the outcome.
pub fn oracle_gate_step(workspace_root: &Utf8Path) -> StepReport {
    let subject = compiler_subject();

    if let Some(problem) = missing_node_modules_problem(workspace_root) {
        return StepReport::failed_with(ORACLE_STEP, &format!("{ORACLE_STEP}: {problem}"));
    }

    if let Some(problem) = unplugged_compiler_problem(workspace_root, subject.as_deref()) {
        return StepReport::failed_with(ORACLE_STEP, &format!("{ORACLE_STEP}: {problem}"));
    }

    let request = OracleRequest {
        selection: default_selection(),
        tool: None,
    };

    match run_oracle_task(workspace_root, &request) {
        Ok(verdict) => {
            let outcome = if verdict.passed() {
                StepOutcome::Passed { step: ORACLE_STEP }
            } else {
                StepOutcome::Failed { step: ORACLE_STEP }
            };

            StepReport {
                outcome,
                stdout: format!("{verdict}\n"),
                stderr: String::new(),
            }
        }
        Err(error) => StepReport::failed_with(ORACLE_STEP, &format!("{ORACLE_STEP}: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use camino::Utf8PathBuf;

    use super::*;

    fn scratch_workspace(name: &str, with_compiler_crate: &[&str]) -> Utf8PathBuf {
        let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("xtask-oracle-{name}-{}", std::process::id()));

        for file in with_compiler_crate {
            let path = directory.join(file);

            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }

        fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn no_subject_is_fine_while_there_is_no_compiler_crate() {
        let workspace = scratch_workspace("absent", &[]);

        assert_eq!(unplugged_compiler_problem(&workspace, None), None);

        fs::remove_dir_all(&workspace).unwrap();
    }

    #[test]
    fn no_subject_fails_once_the_compiler_crate_exists() {
        let workspace = scratch_workspace("present", &[COMPILER_MANIFEST]);

        let problem = unplugged_compiler_problem(&workspace, None);

        fs::remove_dir_all(&workspace).unwrap();

        assert!(
            problem.is_some_and(|problem| problem.contains("no subject plugged in")),
            "{problem:?}"
        );
    }

    #[test]
    fn a_plugged_subject_passes_with_the_compiler_crate() {
        let workspace = scratch_workspace("plugged", &[COMPILER_MANIFEST]);

        let problem = unplugged_compiler_problem(&workspace, Some(&NothingPortedSubject));

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(problem, None);
    }
}
