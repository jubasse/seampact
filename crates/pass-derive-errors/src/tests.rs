//! Unit tests of the ported functions that read a context the fixtures never fake, and of the
//! JavaScript behaviours they depend on (`RegExp.source`, number comparisons, first-wins order).

use seampact_diagnostics::{Diagnostic, InternalError};
use seampact_ir::{Layer, NatureBase, Origin};
use seampact_pipeline::testing::HalfFixture;

use crate::natures::derive_errors_natures;
use crate::operations::dedupe;
use crate::registry::{derive_errors_default_family, derive_errors_default_nature, regexp_source};
use crate::report::{
    DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter, DeriveErrorsRule,
    derive_errors_reporter,
};

const NATURES: &str = r#"{
  "natures": {
    "refused": { "base": "failed" },
    "slow": { "base": "unavailable", "summary": "Slow", "description": "Takes long" }
  }
}"#;

pub(crate) fn with_reporter<R>(
    text: &str,
    body: impl FnOnce(&mut DeriveErrorsReporter<'_, '_>) -> R,
) -> Result<(R, Vec<Diagnostic>), InternalError> {
    let mut fixture = HalfFixture::from_json(text)?;
    let result = fixture.with_context(|context| {
        let mut reporter = derive_errors_reporter(context);

        body(&mut reporter)
    })?;

    Ok((result, fixture.into_diagnostics()))
}

fn problem(pointer: &str) -> DeriveErrorsProblem {
    DeriveErrorsProblem {
        rule: DeriveErrorsRule::NatureBase,
        message: "message".to_owned(),
        fix: "fix".to_owned(),
        pointer: pointer.to_owned(),
        related: vec![DeriveErrorsRelated {
            pointer: "/b".to_owned(),
            message: "the other".to_owned(),
        }],
    }
}

#[test]
fn a_problem_is_reported_at_its_pointer_with_its_related_locations() {
    let (result, reported) = with_reporter(r#"{"a":{"x":1},"b":2}"#, |reporter| {
        reporter.error(problem("/a/x"))
    })
    .unwrap();

    assert_eq!(result, Ok(()));

    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(diagnostic.rule.as_str(), "seampact/derive/nature-base");
    assert_eq!(diagnostic.origin.pointer, "/a/x");
    assert_eq!(
        diagnostic
            .related
            .first()
            .map(|r| r.origin.pointer.as_str()),
        Some("/b")
    );
}

#[test]
fn a_pointer_without_an_origin_is_an_internal_error_and_reports_nothing() {
    let (result, reported) = with_reporter(r#"{"a":1,"b":2}"#, |reporter| {
        reporter
            .error(problem("/nowhere"))
            .map_err(|error| error.what().to_owned())
    })
    .unwrap();

    let message = result.err().unwrap_or_default();

    assert!(message.contains("/nowhere"), "message {message:?}");
    assert!(message.contains("has no origin"), "message {message:?}");
    assert_eq!(reported, Vec::new());
}

#[test]
fn a_nature_named_like_a_base_is_reported_and_left_out() {
    let (natures, reported) = with_reporter(NATURES, |reporter| {
        let context = reporter.context();

        derive_errors_natures(context, reporter)
    })
    .unwrap();
    let natures = natures.unwrap();

    assert_eq!(natures.len(), 1);

    let slow = natures.get("slow").unwrap();

    assert_eq!(slow.base, NatureBase::Unavailable);
    assert_eq!(slow.docs.summary.as_deref(), Some("Slow"));
    assert_eq!(slow.origin.pointer, "/natures/slow");

    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(diagnostic.rule.as_str(), "seampact/derive/nature-base");
    assert!(
        diagnostic
            .message
            .ends_with("the base natures are refused, unavailable, failed"),
        "message {:?}",
        diagnostic.message
    );
}

#[test]
fn a_nature_mapped_onto_no_base_is_an_internal_error() {
    let (result, _) = with_reporter(r#"{"natures":{"odd":{"base":"weird"}}}"#, |reporter| {
        let context = reporter.context();

        derive_errors_natures(context, reporter).map_err(|error| error.what().to_owned())
    })
    .unwrap();

    assert_eq!(
        result.err().as_deref(),
        Some("nature 'odd' maps onto 'weird', which the authoring schema refuses")
    );
}

#[test]
fn the_default_nature_of_a_status_follows_adr_0002() {
    for status in [408, 425, 429, 502, 503, 504] {
        assert_eq!(
            derive_errors_default_nature(status),
            NatureBase::Unavailable
        );
    }

    assert_eq!(derive_errors_default_nature(499), NatureBase::Refused);
    assert_eq!(derive_errors_default_nature(500), NatureBase::Failed);
    assert_eq!(derive_errors_default_nature(501), NatureBase::Failed);
}

#[test]
fn the_default_family_is_the_text_before_the_first_dot() {
    assert_eq!(
        derive_errors_default_family("api.rate_limited"),
        Some("api")
    );
    assert_eq!(derive_errors_default_family("a.b.c"), Some("a"));
    assert_eq!(derive_errors_default_family("plain"), None);
    assert_eq!(derive_errors_default_family(".leading"), None);
    assert_eq!(derive_errors_default_family("é.x"), Some("é"));
}

#[test]
fn regexp_source_writes_what_javascript_writes() {
    assert_eq!(regexp_source(""), "(?:)");
    assert_eq!(regexp_source("^a/b$"), "^a\\/b$");
    assert_eq!(regexp_source("[/]"), "[/]");
    assert_eq!(regexp_source("a\\/b"), "a\\/b");
    assert_eq!(regexp_source("a\nb"), "a\\nb");
    assert_eq!(regexp_source("a\u{2028}b"), "a\\u2028b");
}

fn origin(api: Option<&str>, layer: Layer, pointer: &str) -> Origin {
    Origin {
        api: api.map(str::to_owned),
        layer,
        pointer: pointer.to_owned(),
    }
}

#[test]
fn dedupe_keeps_the_first_of_each_origin_and_tells_apis_apart() {
    let first = origin(None, Layer::Api, "/a");
    let other_api = origin(Some("shop"), Layer::Api, "/a");
    let other_layer = origin(None, Layer::Shared, "/a");

    let unique = dedupe(&[
        first.clone(),
        other_api.clone(),
        first.clone(),
        other_layer.clone(),
        other_api.clone(),
    ]);

    assert_eq!(unique, vec![first, other_api, other_layer]);
}

#[test]
fn rule_ids_are_every_rule_of_the_half() {
    let from_rules: Vec<_> = DeriveErrorsRule::ALL
        .iter()
        .map(|rule| rule.rule_id())
        .collect();

    assert_eq!(crate::RULE_IDS, from_rules.as_slice());
}
