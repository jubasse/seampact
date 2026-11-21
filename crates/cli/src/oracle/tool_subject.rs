//! The tool subject the oracle runs beside the compiler.

use camino::Utf8Path;
use seampact_json::JsonValue;
use seampact_oracle::{
    BundleAnswer, BundleCase, CliCase, DiffAnswer, DiffCase, Fixture, MergeCase, OpenApiAnswer,
    RecordedAnswer, RecordedToolCall, RecordedUnit, RuleIdRegistry, StagePorting, StageRuleIds,
    SubjectAnswer, ToolSubject, Transcript,
};

use crate::oracle::{bundle, cli_case, diff, lint, openapi, recorded};

/// The tools of layer 3.2, each case run through the entry functions of the port.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CliToolSubject;

impl ToolSubject for CliToolSubject {
    fn openapi(&self, ir: &JsonValue, options: Option<&JsonValue>) -> SubjectAnswer<OpenApiAnswer> {
        openapi::openapi_answer(ir, options)
    }

    fn openapi_merge(&self, case: &MergeCase) -> SubjectAnswer<OpenApiAnswer> {
        openapi::openapi_merge_answer(case)
    }

    fn lint(&self, fixture: &Fixture, api: &str) -> SubjectAnswer<JsonValue> {
        lint::lint_answer(fixture, api)
    }

    fn diff_table(&self) -> SubjectAnswer<JsonValue> {
        diff::diff_table_answer()
    }

    fn diff(&self, case: &DiffCase) -> SubjectAnswer<DiffAnswer> {
        diff::diff_answer(case)
    }

    fn bundle(&self, case: &BundleCase) -> SubjectAnswer<BundleAnswer> {
        bundle::bundle_answer(case)
    }

    fn recorded_call(
        &self,
        unit: RecordedUnit,
        call: &RecordedToolCall,
        root: &Utf8Path,
    ) -> SubjectAnswer<RecordedAnswer> {
        recorded::recorded_answer(unit, call, root)
    }

    fn cli(&self, case: &CliCase, root: &Utf8Path) -> SubjectAnswer<Transcript> {
        cli_case::cli_answer(case, root)
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        let stages = vec![
            StageRuleIds {
                stage: "lint",
                rule_ids: seampact_lint::RULE_IDS,
            },
            StageRuleIds {
                stage: "bundle",
                rule_ids: seampact_bundle::RULE_IDS,
            },
            StageRuleIds {
                stage: "bundle-fetch",
                rule_ids: seampact_bundle_fetch::RULE_IDS,
            },
            StageRuleIds {
                stage: "cli-config",
                rule_ids: seampact_cli_config::RULE_IDS,
            },
            StageRuleIds {
                stage: "editor-schemas",
                rule_ids: seampact_editor_schemas::RULE_IDS,
            },
            StageRuleIds {
                stage: "cli",
                rule_ids: crate::RULE_IDS,
            },
        ];

        RuleIdRegistry {
            stages,
            porting: StagePorting::Partial,
        }
    }
}
