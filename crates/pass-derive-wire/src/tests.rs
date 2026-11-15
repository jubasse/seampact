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

mod ported_functions {
    use seampact_ir::HeaderUseFor;

    use crate::identity_headers::applies;
    use crate::paging::integer_use;
    use crate::params::{DeriveWireParamPlace, same_name};

    #[test]
    fn header_names_compare_case_insensitively_and_query_names_exactly() {
        assert!(same_name(
            DeriveWireParamPlace::Header,
            "If-Match",
            "if-match"
        ));
        assert!(!same_name(DeriveWireParamPlace::Query, "limit", "Limit"));
        // `toLowerCase` maps the final sigma as Rust does.
        assert!(same_name(DeriveWireParamPlace::Header, "ΟΔΟΣ", "οδος"));
    }

    #[test]
    fn integer_bounds_are_written_as_their_number_text() {
        let refinements = integer_use(0, Some(9_007_199_254_740_991)).refinements;

        assert_eq!(
            refinements
                .minimum
                .as_ref()
                .map(|value| value.as_str().to_owned()),
            Some("0".to_owned())
        );
        assert_eq!(
            refinements.maximum.as_ref().map(|v| v.as_str().to_owned()),
            Some("9007199254740991".to_owned())
        );
        assert!(integer_use(1, None).refinements.maximum.is_none());
    }

    #[test]
    fn a_header_use_applies_by_its_for_and_the_operation_safety() {
        assert!(applies(&HeaderUseFor::All, true));
        assert!(applies(&HeaderUseFor::All, false));
        assert!(applies(&HeaderUseFor::Reads, true));
        assert!(!applies(&HeaderUseFor::Reads, false));
        assert!(applies(&HeaderUseFor::Writes, false));
        assert!(!applies(&HeaderUseFor::Writes, true));
    }
}
