//! The rule ids the stages declare, held against the keys of `fixtures/expected/rule-coverage.json`.

use std::collections::BTreeSet;

use camino::Utf8Path;
use seampact_diagnostics::RuleId;
use serde_json::Value;

use crate::OracleError;
use crate::fixtures::read_text;

/// The rule coverage file, relative to the repository root.
pub const RULE_COVERAGE_FILE: &str = "fixtures/expected/rule-coverage.json";

/// The rule ids one stage declares: its `RULES` constant.
#[derive(Debug, Clone, Copy)]
pub struct StageRuleIds {
    /// The stage, as the second segment of its ids names it (`load`, `tree`).
    pub stage: &'static str,
    /// Every id the stage can emit; run-time ids (the finalize schema and invariant rules) are not
    /// listed, as `rule-coverage.json` does not list them.
    pub rule_ids: &'static [RuleId],
}

/// Whether every stage of the compiler is ported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagePorting {
    /// Some stages are not ported: their ids are missing from the registry.
    Partial,
    /// Every stage is ported: the registry lists every id.
    Complete,
}

/// The rule ids of the ported stages, every stage filling its own entry.
#[derive(Debug, Clone)]
pub struct RuleIdRegistry {
    /// One entry per ported stage.
    pub stages: Vec<StageRuleIds>,
    /// Whether every stage is ported.
    pub porting: StagePorting,
}

impl RuleIdRegistry {
    /// The registry of a subject that has ported no stage.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            stages: Vec::new(),
            porting: StagePorting::Partial,
        }
    }
}

/// The rule ids of a registry held against the coverage keys.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleIdCheck {
    /// How many distinct coverage keys the registry declares.
    pub declared: usize,
    /// How many keys `rule-coverage.json` has.
    pub total: usize,
    /// Whether every stage is ported, so the two sets must be equal.
    pub porting: StagePorting,
    /// One line per problem: an id no key names, or a key no stage declares once all are ported.
    pub problems: Vec<String>,
}

/// Holds the registry against the keys of `rule-coverage.json`.
///
/// # Errors
///
/// When the coverage file cannot be read or is no JSON object.
pub fn check_rule_ids(
    repository_root: &Utf8Path,
    registry: &RuleIdRegistry,
) -> Result<RuleIdCheck, OracleError> {
    let coverage_keys = coverage_keys(repository_root)?;

    Ok(rule_id_check(registry, &coverage_keys))
}

fn coverage_keys(repository_root: &Utf8Path) -> Result<BTreeSet<String>, OracleError> {
    let path = repository_root.join(RULE_COVERAGE_FILE);
    let coverage: Value =
        serde_json::from_str(&read_text(&path)?).map_err(|source| OracleError::Json {
            path: path.clone(),
            source,
        })?;

    let Value::Object(members) = coverage else {
        return Err(OracleError::Shape {
            path,
            problem: "the rule coverage is an object of rule ids".to_owned(),
        });
    };

    Ok(members.into_iter().map(|(rule_id, _)| rule_id).collect())
}

/// Holds the registry against a set of coverage keys.
#[must_use]
pub fn rule_id_check(registry: &RuleIdRegistry, coverage_keys: &BTreeSet<String>) -> RuleIdCheck {
    let declared_ids: BTreeSet<&str> = registry
        .stages
        .iter()
        .flat_map(|stage| stage.rule_ids.iter().map(RuleId::as_str))
        .collect();

    let mut problems: Vec<String> = declared_ids
        .iter()
        .filter(|rule_id| !coverage_keys.contains(**rule_id))
        .map(|rule_id| format!("rule id {rule_id} is no key of {RULE_COVERAGE_FILE}"))
        .collect();

    if registry.porting == StagePorting::Complete {
        problems.extend(
            coverage_keys
                .iter()
                .filter(|key| !declared_ids.contains(key.as_str()))
                .map(|key| {
                    format!("rule id {key} of {RULE_COVERAGE_FILE} is declared by no stage")
                }),
        );
    }

    let declared = declared_ids
        .iter()
        .filter(|rule_id| coverage_keys.contains(**rule_id))
        .count();

    RuleIdCheck {
        declared,
        total: coverage_keys.len(),
        porting: registry.porting,
        problems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOAD_RULES: &[RuleId] = &[
        RuleId::from_static("seampact/load/path-empty"),
        RuleId::from_static("seampact/load/path-escpe"),
    ];

    fn keys() -> BTreeSet<String> {
        ["seampact/load/path-empty", "seampact/tree/default-value"]
            .map(str::to_owned)
            .into()
    }

    #[test]
    fn a_misspelt_id_fails_while_stages_are_missing() {
        let registry = RuleIdRegistry {
            stages: vec![StageRuleIds {
                stage: "load",
                rule_ids: LOAD_RULES,
            }],
            porting: StagePorting::Partial,
        };

        let check = rule_id_check(&registry, &keys());

        assert_eq!(check.declared, 1);
        assert_eq!(check.total, 2);
        assert_eq!(
            check.problems,
            vec![format!(
                "rule id seampact/load/path-escpe is no key of {RULE_COVERAGE_FILE}"
            )]
        );
    }

    #[test]
    fn once_every_stage_is_ported_a_key_no_stage_declares_fails() {
        let registry = RuleIdRegistry {
            stages: vec![StageRuleIds {
                stage: "load",
                rule_ids: LOAD_RULES.get(..1).unwrap(),
            }],
            porting: StagePorting::Complete,
        };

        let check = rule_id_check(&registry, &keys());

        assert_eq!(
            check.problems,
            vec![format!(
                "rule id seampact/tree/default-value of {RULE_COVERAGE_FILE} is declared by no stage"
            )]
        );
    }
}
