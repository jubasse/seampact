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
mod rule_ids;
mod run;
mod subject;
mod verdict;
mod yaml_value;

pub use compare::{Mismatch, MismatchKind, text_mismatches, value_mismatches};
pub use differences::{
    Applies, DIFFERENCES_FILE, Difference, DifferenceChange, Differences, differences_problems,
    read_differences,
};
pub use error::OracleError;
pub use expected::{
    DIAGNOSTICS_FILE, ExpectedFiles, OutputFile, OutputKind, expected_directory_of,
    expected_fixture_paths, read_expected_files,
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
pub use subject::{Compilation, CompiledApi, OracleSubject, SubjectAnswer};
pub use verdict::{FirstFailure, Verdict};
pub use yaml_value::yaml_to_json;
