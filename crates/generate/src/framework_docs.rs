//! The `frameworkDocs` switch of an entry: only a server target reads it, and only some can
//! switch their framework's own document off.

use seampact_cli_config::{
    CliProblem, FrameworkDocsSwitch, TargetEntrySettings, entry_where, located_problem,
};
use seampact_target::{Generator, TargetRole};

const NO_SWITCH_FIX: &str = "Remove `frameworkDocs: off` from the entry: this target writes no switch for its framework's own document.";

/// The problems of `frameworkDocs` on `entry`: a target that is no server, or `off` on a target
/// that cannot switch the document off.
#[must_use]
pub fn framework_docs_problems(
    entry: &TargetEntrySettings,
    target: &dyn Generator,
) -> Vec<CliProblem> {
    let Some(switch) = entry.framework_docs else {
        return Vec::new();
    };
    let metadata = target.metadata();

    if metadata.role != TargetRole::Server {
        return vec![located_problem(
            "config.key.unsupported",
            format!(
                "The target '{}' is no server target, so it cannot read 'frameworkDocs'.",
                entry.use_name
            ),
            "Remove 'frameworkDocs' from the entry; it belongs to a server target's entry.",
            entry_where(&entry.id, None),
        )];
    }

    if switch != FrameworkDocsSwitch::Off {
        return Vec::new();
    }

    vec![located_problem(
        "config.frameworkDocs.unsupported",
        format!(
            "The target '{}' cannot switch its framework's own OpenAPI document off.",
            entry.use_name
        ),
        metadata.framework_docs_off_fix.unwrap_or(NO_SWITCH_FIX),
        entry_where(&entry.id, None),
    )]
}
