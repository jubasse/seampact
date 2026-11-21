//! Severity and allows (ADR 0006 section 4, grammar 12): a rule's severity is the contract's
//! setting, else the rule's default; an allow silences a finding at a place the rule names, the
//! compiler having set `subtree: false` for every allow that holds at its own node only.

use std::collections::HashSet;

use seampact_authoring::Locations;
use seampact_diagnostics::{Diagnostic, DiagnosticOrigin, InternalError, Severity};
use seampact_ir::{Lint, LintAllow, LintSeverity, Origin};
use seampact_json::escape_pointer;
use seampact_validate::closest_keyword;

use crate::core_rule::{CORE_PLUGIN_NAME, CoreRule};
use crate::lint_setting_rule::LintSettingRule;
use crate::origins::lint_origin_key;

/// Ids the grammar table lists that no rule implements yet: the compiler refuses an unresolved
/// output subject instead of writing `always: absent`, so `seampact/field-right-unresolved` could
/// never fire. A setting naming one is accepted and has no effect until the rule ships.
pub(crate) const LINT_RESERVED_RULE_IDS: [&str; 1] = ["seampact/field-right-unresolved"];

/// What a rule does once the contract's setting is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EffectiveSeverity {
    /// The rule does not run.
    Disabled,
    /// The rule runs and its findings carry this severity.
    Reported(Severity),
}

/// Where a rule id is named in the settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MentionPlace {
    Rules,
    Allow,
}

impl MentionPlace {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Rules => "lint.rules",
            Self::Allow => "lint.allow",
        }
    }
}

/// A rule id named in `lint.rules` or `lint.allow`.
struct RuleMention {
    id: String,
    place: MentionPlace,
    origin: Origin,
}

/// The severity of the rule `id`: the contract's setting, else `default`.
///
/// # Errors
///
/// An [`InternalError`] for a setting that is not `disabled`, `warning` or `error`.
pub(crate) fn lint_severity_of(
    lint: &Lint,
    id: &str,
    default: EffectiveSeverity,
) -> Result<EffectiveSeverity, InternalError> {
    let Some(set) = lint.rules.get(id) else {
        return Ok(default);
    };

    match &set.severity {
        LintSeverity::Disabled => Ok(EffectiveSeverity::Disabled),
        LintSeverity::Warning => Ok(EffectiveSeverity::Reported(Severity::Warning)),
        LintSeverity::Error => Ok(EffectiveSeverity::Reported(Severity::Error)),
        LintSeverity::Unknown(value) => Err(InternalError::new(format!(
            "lint.rules sets '{id}' to '{value}': use disabled, warning or error"
        ))),
    }
}

fn same_origin(first: &Origin, second: &Origin) -> bool {
    first.layer == second.layer && first.pointer == second.pointer
}

fn is_below(pointer: &str, ancestor: &str) -> bool {
    pointer
        .strip_prefix(ancestor)
        .is_some_and(|rest| rest.starts_with('/'))
}

fn allow_covers(allow: &LintAllow, place: &Origin) -> bool {
    if same_origin(&allow.at, place) {
        return true;
    }

    allow.subtree && allow.at.layer == place.layer && is_below(&place.pointer, &allow.at.pointer)
}

/// Whether an allow for `rule_id` covers one of `places`.
pub(crate) fn lint_is_allowed(lint: &Lint, rule_id: &str, places: &[Origin]) -> bool {
    lint.allows
        .iter()
        .any(|allow| allow.rule == rule_id && places.iter().any(|place| allow_covers(allow, place)))
}

/// The plugin name before the first `/` of a rule id, empty without one.
fn plugin_prefix(id: &str) -> &str {
    id.split_once('/').map_or("", |(prefix, _)| prefix)
}

/// The side table origin of the allow entry, else the origin of the allows list.
fn allow_entry_origin(allow: &LintAllow, locations: &Locations) -> Origin {
    let entry = Origin {
        api: None,
        layer: allow.at.layer.clone(),
        pointer: format!(
            "{}/lint/allow/{}",
            allow.at.pointer,
            escape_pointer(&allow.rule)
        ),
    };
    if locations.contains_key(&lint_origin_key(&entry)) {
        entry
    } else {
        allow.at.clone()
    }
}

/// An origin as a diagnostic's, without the api of a relay copy.
///
/// # Errors
///
/// An [`InternalError`] for a core origin, which has no file.
pub(crate) fn diagnostic_origin_of(origin: &Origin) -> Result<DiagnosticOrigin, InternalError> {
    let Some(located) = DiagnosticOrigin::of(origin) else {
        return Err(InternalError::new(format!(
            "a lint setting cannot be located at a core origin {}",
            origin.pointer
        )));
    };

    Ok(DiagnosticOrigin {
        api: None,
        ..located
    })
}

fn mentions_of(lint: &Lint, locations: &Locations) -> Vec<RuleMention> {
    let in_rules = lint.rules.iter().map(|(id, rule)| RuleMention {
        id: id.clone(),
        place: MentionPlace::Rules,
        origin: rule.origin.clone(),
    });
    let in_allows = lint.allows.iter().map(|allow| RuleMention {
        id: allow.rule.clone(),
        place: MentionPlace::Allow,
        origin: allow_entry_origin(allow, locations),
    });

    in_rules.chain(in_allows).collect()
}

fn unknown_rule_diagnostic(mention: &RuleMention) -> Result<Diagnostic, InternalError> {
    let known: Vec<String> = CoreRule::ALL
        .iter()
        .map(|rule| rule.as_str().to_owned())
        .collect();
    let fix = match closest_keyword(&mention.id, &known) {
        Some(closest) => format!("Use '{closest}', or remove the entry."),
        None => format!("Use one of {}, or remove the entry.", known.join(", ")),
    };

    Ok(Diagnostic {
        severity: Severity::Error,
        rule: LintSettingRule::UnknownRule.rule_id(),
        message: format!(
            "{} names the lint rule '{}', which the plugin '{CORE_PLUGIN_NAME}' does not have",
            mention.place.as_str(),
            mention.id
        ),
        fix,
        origin: diagnostic_origin_of(&mention.origin)?,
        related: Vec::new(),
    })
}

fn unclaimed_rule_diagnostic(mention: &RuleMention) -> Result<Diagnostic, InternalError> {
    Ok(Diagnostic {
        severity: Severity::Warning,
        rule: LintSettingRule::UnclaimedRule.rule_id(),
        message: format!(
            "{} names the lint rule '{}', which no loaded plugin owns, so the setting is ignored",
            mention.place.as_str(),
            mention.id
        ),
        fix: "Load the plugin that owns the rule, or remove the entry.".to_owned(),
        origin: diagnostic_origin_of(&mention.origin)?,
        related: Vec::new(),
    })
}

/// One diagnostic per setting that names a rule no core rule has, once per place.
///
/// # Errors
///
/// An [`InternalError`] for a setting located at a core origin.
pub(crate) fn lint_unknown_rule_diagnostics(
    lint: &Lint,
    locations: &Locations,
) -> Result<Vec<Diagnostic>, InternalError> {
    let known: HashSet<&str> = LINT_RESERVED_RULE_IDS
        .into_iter()
        .chain(CoreRule::ALL.iter().map(|rule| rule.as_str()))
        .collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut diagnostics = Vec::new();

    for mention in mentions_of(lint, locations) {
        let key = format!(
            "{}\n{}\n{}",
            mention.place.as_str(),
            mention.id,
            lint_origin_key(&mention.origin)
        );

        if known.contains(mention.id.as_str()) || !seen.insert(key) {
            continue;
        }

        diagnostics.push(if plugin_prefix(&mention.id) == CORE_PLUGIN_NAME {
            unknown_rule_diagnostic(&mention)?
        } else {
            unclaimed_rule_diagnostic(&mention)?
        });
    }

    Ok(diagnostics)
}

#[cfg(test)]
mod tests {
    use seampact_ir::{IrMap, Layer, LintRule, Reason};

    use super::*;

    fn origin(layer: Layer, pointer: &str) -> Origin {
        Origin {
            api: None,
            layer,
            pointer: pointer.to_owned(),
        }
    }

    fn allow(rule: &str, at: Origin, subtree: bool) -> LintAllow {
        LintAllow {
            rule: rule.to_owned(),
            at,
            reason: Reason::new("because".to_owned()),
            subtree,
        }
    }

    fn lint_with(rules: Vec<(&str, LintSeverity, Origin)>, allows: Vec<LintAllow>) -> Lint {
        let mut set = IrMap::new();

        for (id, severity, origin) in rules {
            set.insert(id.to_owned(), LintRule { severity, origin });
        }

        Lint { rules: set, allows }
    }

    const DEFAULT: EffectiveSeverity = EffectiveSeverity::Reported(Severity::Warning);

    #[test]
    fn a_rule_reports_at_its_default_severity_unless_the_contract_sets_it() {
        let here = origin(Layer::Api, "/lint/rules/a");
        let lint = lint_with(
            vec![
                ("a", LintSeverity::Error, here.clone()),
                ("b", LintSeverity::Disabled, here),
            ],
            vec![],
        );

        assert_eq!(lint_severity_of(&lint, "none", DEFAULT), Ok(DEFAULT));
        assert_eq!(
            lint_severity_of(&lint, "a", DEFAULT),
            Ok(EffectiveSeverity::Reported(Severity::Error))
        );
        assert_eq!(
            lint_severity_of(&lint, "b", DEFAULT),
            Ok(EffectiveSeverity::Disabled)
        );
    }

    #[test]
    fn an_id_named_like_a_prototype_member_has_no_setting() {
        let lint = lint_with(vec![], vec![]);

        assert_eq!(lint_severity_of(&lint, "constructor", DEFAULT), Ok(DEFAULT));
    }

    #[test]
    fn an_allow_covers_its_own_place_and_a_subtree_allow_the_places_below() {
        let at = origin(Layer::Api, "/surfaces/app");
        let exact = lint_with(vec![], vec![allow("r", at.clone(), false)]);
        let subtree = lint_with(vec![], vec![allow("r", at.clone(), true)]);
        let below = origin(Layer::Api, "/surfaces/app/routes/a");
        let lookalike = origin(Layer::Api, "/surfaces/application");
        let other_layer = origin(Layer::Shared, "/surfaces/app");

        assert!(lint_is_allowed(&exact, "r", std::slice::from_ref(&at)));
        assert!(!lint_is_allowed(&exact, "r", std::slice::from_ref(&below)));
        assert!(lint_is_allowed(&subtree, "r", std::slice::from_ref(&below)));
        assert!(!lint_is_allowed(
            &subtree,
            "r",
            std::slice::from_ref(&lookalike)
        ));
        assert!(!lint_is_allowed(
            &subtree,
            "r",
            std::slice::from_ref(&other_layer)
        ));
        assert!(!lint_is_allowed(
            &subtree,
            "other",
            std::slice::from_ref(&at)
        ));
        assert!(lint_is_allowed(&exact, "r", &[lookalike, at]));
    }

    #[test]
    fn an_unknown_core_id_names_the_closest_rule_and_is_located_at_its_entry() {
        let rule_origin = origin(Layer::Api, "/lint/rules/seampact~1credential-nam");
        let lint = lint_with(
            vec![("seampact/credential-nam", LintSeverity::Error, rule_origin)],
            vec![],
        );
        let diagnostics = lint_unknown_rule_diagnostics(&lint, &Locations::new());

        let Ok(diagnostics) = diagnostics else {
            panic!("the diagnostics are expected");
        };
        let [diagnostic] = diagnostics.as_slice() else {
            panic!("one diagnostic is expected, got {diagnostics:?}");
        };

        assert_eq!(diagnostic.severity, Severity::Error);
        assert_eq!(diagnostic.rule, LintSettingRule::UnknownRule.rule_id());
        assert_eq!(
            diagnostic.fix,
            "Use 'seampact/credential-name', or remove the entry."
        );
        assert_eq!(
            diagnostic.message,
            "lint.rules names the lint rule 'seampact/credential-nam', which the plugin 'seampact' does not have"
        );
    }

    #[test]
    fn an_id_no_plugin_owns_is_a_warning_and_the_reserved_id_is_accepted() {
        let here = origin(Layer::Api, "/lint/rules/x");
        let lint = lint_with(
            vec![
                ("house/rule", LintSeverity::Error, here.clone()),
                ("seampact/field-right-unresolved", LintSeverity::Error, here),
            ],
            vec![],
        );
        let diagnostics = lint_unknown_rule_diagnostics(&lint, &Locations::new());

        let Ok(diagnostics) = diagnostics else {
            panic!("the diagnostics are expected");
        };
        let rules: Vec<&str> = diagnostics.iter().map(|d| d.rule.as_str()).collect();

        assert_eq!(rules, vec!["seampact/lint/unclaimed-rule"]);
        assert_eq!(
            diagnostics.first().map(|d| d.severity),
            Some(Severity::Warning)
        );
    }

    #[test]
    fn a_setting_at_a_core_origin_is_refused_only_when_it_is_reported() {
        let core = origin(Layer::Core, "/lint/rules/x");
        let known = lint_with(
            vec![(
                "seampact/credential-name",
                LintSeverity::Error,
                core.clone(),
            )],
            vec![],
        );
        let unknown = lint_with(vec![("house/rule", LintSeverity::Error, core)], vec![]);

        assert_eq!(
            lint_unknown_rule_diagnostics(&known, &Locations::new()),
            Ok(Vec::new())
        );
        assert!(lint_unknown_rule_diagnostics(&unknown, &Locations::new()).is_err());
    }

    #[test]
    fn the_plugin_prefix_is_the_text_before_the_first_slash() {
        assert_eq!(plugin_prefix("seampact/a/b"), "seampact");
        assert_eq!(plugin_prefix("noslash"), "");
        assert_eq!(plugin_prefix("\u{1F600}/x"), "\u{1F600}");
    }
}
