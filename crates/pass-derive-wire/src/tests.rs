//! Unit tests of the ported functions that read a context the fixtures never fake, and of the
//! JavaScript behaviours they depend on.

use seampact_diagnostics::RuleId;

use crate::RULE_IDS;
use crate::report::DeriveWireRule;

#[test]
fn the_rule_ids_are_every_rule_of_the_half() {
    let from_rules: Vec<RuleId> = DeriveWireRule::ALL
        .iter()
        .map(|rule| rule.rule_id())
        .collect();

    assert_eq!(RULE_IDS, from_rules.as_slice());
}

#[test]
fn a_rule_id_is_the_derive_namespace_and_the_rule_name() {
    for rule in DeriveWireRule::ALL {
        assert_eq!(
            rule.rule_id().as_str(),
            format!("seampact/derive/{}", rule.name()),
            "rule {rule:?}"
        );
    }
}
