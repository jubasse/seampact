//! The oracle harness of the Rust port: the acceptance test of every port lane.
//!
//! [`run_oracle`] compiles every selected fixture with an [`OracleSubject`] and compares its
//! outputs with `fixtures/expected/` (read by [`read_expected_files`]) under the intended
//! differences of `differences.yaml` ([`read_differences`]), as `scripts/oracle/README.md`
//! states; the [`Verdict`] gives the counts and the first failing mismatch. A subject answers
//! [`SubjectAnswer::NotPorted`] for what its stages cannot produce yet, which never fails.

mod compare;
mod differences;
mod error;
mod expected;
mod fixtures;
mod glob;
mod matcher;
mod raw_text;
mod rule_ids;
mod run;
mod run_root;
mod subject;
mod time_limit;
mod tool_cases;
mod tool_compare;
mod tool_discovery;
mod tool_outputs;
mod tool_run;
mod tool_run_cli;
mod tool_subject;
mod tool_verdict;
mod ustar_listing;
mod verdict;
mod yaml_value;

pub use compare::{Mismatch, MismatchKind, text_mismatches, value_mismatches};
pub use differences::{
    Applies, DIFFERENCES_FILE, Difference, DifferenceChange, Differences, differences_problems,
    read_differences,
};
pub use error::OracleError;
pub use expected::{
    DIAGNOSTICS_FILE, ExpectedFiles, OutputFile, OutputKind, RecordedCall, expected_directory_of,
    expected_fixture_paths, read_expected_files, read_schema_calls, schema_calls_file,
};
pub use fixtures::{
    EXPECTED_DIRECTORY, ExcludedFixtures, FIXTURES_DIRECTORY, Fixture, discover_fixtures,
    read_excluded,
};
pub use glob::{FixtureGlob, entry_glob_matches};
pub use matcher::{ComparedFile, DifferenceLedger, MatchOutcome, entry_matches};
pub use rule_ids::{
    RULE_COVERAGE_FILE, RuleIdCheck, RuleIdRegistry, StagePorting, StageRuleIds, check_rule_ids,
    rule_id_check,
};
pub use run::{Selection, run_oracle};
pub use run_root::{GIT_SOURCE_REPOSITORY, ROOT_TOKEN, RunRoot, prepared_run_root};
pub use subject::{
    ApiDeltas, Compilation, CompiledApi, ExpectedDelta, HalfInput, HalfOutput, OracleSubject,
    SubjectAnswer,
};
pub use time_limit::TimeLimitAction;
pub use tool_cases::{
    BundleCase, CASE_TODAY, CliCase, DiffCase, DiffSide, ExpectedTranscript, ExpectedWrittenFile,
    MergeCase, MergeCaseInput, RecordedToolFile, Tool, read_bundle_case, read_cli_case,
    read_diff_case, read_expected_transcript, read_merge_case, read_recorded_tool_file,
};
pub use tool_compare::{
    BUNDLE_MANIFEST_FILE, line_mismatches, manifest_mismatches, normalized_manifest, sha256_hex,
    written_mismatches, yaml_mismatches,
};
pub use tool_discovery::{ToolCaseKind, ToolCasePath, discover_tool_cases};
pub use tool_run::{ToolSelection, run_tools};
pub use tool_subject::{
    BundleAnswer, DiffAnswer, OpenApiAnswer, RecordedAnswer, RecordedToolCall, RecordedUnit,
    ToolSubject, Transcript,
};
pub use tool_verdict::{ToolTally, ToolVerdict};
pub use ustar_listing::{gunzipped_ustar_entries, ustar_entries};
pub use verdict::{FirstFailure, ServiceCalls, Verdict};
pub use yaml_value::yaml_to_json;
