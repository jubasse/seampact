//! Unit tests of the ported functions that read a context or a service the fixtures never fake,
//! and of the JavaScript behaviours they depend on (UTF-16 order, key order, placeholder counts).

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_diagnostics::{Diagnostic, InternalError};
use seampact_ir::{Direction, RefTypeUse, SchemaId, SchemeId, TypeUse};
use seampact_pipeline::PassError;
use seampact_pipeline::testing::{FakeSchemaService, HalfFixture, raw_api_from_json};

use crate::headers::access_identity_headers;
use crate::identities::{AccessIdentityCatalogues, IdentityEntry, credential_members};
use crate::read::access_identity_entries;
use crate::report::{
    AccessIdentityProblem, AccessIdentityRelated, AccessIdentityReporter, AccessIdentityRule,
    access_identity_once_reporter, access_identity_reporter,
};
use crate::schema_use::access_identity_schema_use;
use crate::schemes::{count_of, placeholders_of};

// Runs `body` over a reporter of an api written as `text`, and answers what it reported.
fn with_reporter<R>(
    text: &str,
    body: impl FnOnce(&mut AccessIdentityReporter<'_, '_>) -> R,
) -> Result<(R, Vec<Diagnostic>), InternalError> {
    let mut fixture = HalfFixture::from_json(text)?;
    let result = fixture.with_context(|context| {
        let mut reporter = access_identity_reporter(context);

        body(&mut reporter)
    })?;

    Ok((result, fixture.into_diagnostics()))
}

fn problem(pointer: &str) -> AccessIdentityProblem {
    AccessIdentityProblem {
        rule: AccessIdentityRule::DenyByDefault,
        message: "message".to_owned(),
        fix: "fix".to_owned(),
        pointer: pointer.to_owned(),
        related: vec![AccessIdentityRelated {
            pointer: "/b".to_owned(),
            message: "the other".to_owned(),
        }],
    }
}

const TWO_POINTERS: &str = r#"{"a":{"x":1},"b":2}"#;

#[test]
fn a_problem_is_reported_at_its_pointer_with_its_related_locations() {
    let (result, reported) = with_reporter(TWO_POINTERS, |reporter| {
        reporter.error(problem("/a/x"))?;

        Ok::<_, seampact_diagnostics::InternalError>(reporter.errors())
    })
    .unwrap();

    assert_eq!(result, Ok(1));

    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(diagnostic.rule.as_str(), "seampact/access/deny-by-default");
    assert_eq!(diagnostic.origin.pointer, "/a/x");
    assert_eq!(diagnostic.related.len(), 1);
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
    let (result, reported) = with_reporter(TWO_POINTERS, |reporter| {
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
fn the_once_reporter_reports_a_repeated_problem_once_through_the_wrapped_reporter() {
    let (base_errors, reported) = with_reporter(TWO_POINTERS, |base| {
        let mut once = access_identity_once_reporter(base);

        for _ in 0..3 {
            assert!(once.error(problem("/a/x")).is_ok());
        }

        assert!(once.error(problem("/b")).is_ok());

        base.errors()
    })
    .unwrap();

    assert_eq!(base_errors, 2);
    assert_eq!(reported.len(), 2);
}

#[test]
fn a_schema_the_service_does_not_answer_is_an_internal_error_naming_the_pointer() {
    let result = access_identity_schema_use(
        &FakeSchemaService::new(),
        "/identities/user/principal",
        &Direction::Output,
    );
    let message = match result {
        Err(PassError::Internal(error)) => error.what().to_owned(),
        other => panic!("an internal error expected, got {other:?}"),
    };

    assert_eq!(
        message,
        "the schema service answers no output type use for the schema written at /identities/user/principal"
    );
}

#[test]
fn placeholders_are_read_left_to_right_without_overlap() {
    let names = |template: &str| placeholders_of(template);

    assert_eq!(names("{sig}"), ["sig"]);
    assert_eq!(names("t={ts},v1={sig}"), ["ts", "sig"]);
    assert_eq!(names("{ts}.{rawBody}.{ts}"), ["ts", "rawBody", "ts"]);
    assert_eq!(names("{{x}}"), ["x"]);
    assert_eq!(names("{x{y}"), ["y"]);
    assert_eq!(names("{}"), Vec::<String>::new());
    assert_eq!(names("{a1}"), Vec::<String>::new());
    assert_eq!(names("{x"), Vec::<String>::new());
    assert!(
        names("{\u{e9}}").is_empty(),
        "a non-ASCII letter is no placeholder letter"
    );
    assert_eq!(names("\u{1F600}{ts}\u{1F600}"), ["ts"]);
}

#[test]
fn a_placeholder_is_counted_by_whole_name() {
    let names = placeholders_of("{ts}{tsx}{ts}");

    assert_eq!(count_of(&names, "ts"), 2);
    assert_eq!(count_of(&names, "tsx"), 1);
    assert_eq!(count_of(&names, "sig"), 0);
}

#[test]
fn entries_come_in_javascript_key_order_and_skip_what_is_no_mapping() {
    let raw = raw_api_from_json(r#"{"schemes":{"b":{},"10":{},"2":{},"é":{},"a":{},"skipped":1}}"#)
        .unwrap();
    let names: Vec<&str> = access_identity_entries(&raw.merged, "schemes")
        .into_iter()
        .map(|(name, _)| name)
        .collect();

    assert_eq!(names, ["2", "10", "b", "\u{e9}", "a"]);
}

#[test]
fn credential_scheme_lists_are_sorted_by_utf16_code_unit() {
    // U+1F600 is the surrogate pair D83D DE00 in UTF-16, which sorts before U+FF5E.
    let text = r#"{"identities":{"user":{"schemes":{"read":["～","😀","b"],"write":[],"optionalRead":["z","a"]}}}}"#;
    let kinds: HashMap<String, Option<String>> = ["\u{ff5e}", "\u{1F600}", "b", "z", "a"]
        .iter()
        .map(|name| ((*name).to_owned(), Some("bearer".to_owned())))
        .collect();
    let headers = IndexMap::new();
    let schemas = seampact_ir::IrMap::new();
    let catalogues = AccessIdentityCatalogues {
        scheme_kinds: &kinds,
        headers: &headers,
        schemas: &schemas,
    };
    let (result, reported) = with_reporter(text, |reporter| {
        let raw = reporter.raw();
        let entries = access_identity_entries(&raw.merged, "identities");
        let Some(&(id, written)) = entries.first() else {
            return Ok(None);
        };
        let mut entry = IdentityEntry {
            id,
            pointer: "/identities/user".to_owned(),
            raw: written,
            catalogues: &catalogues,
            schemas: &FakeSchemaService::new(),
            reporter,
        };

        credential_members(&mut entry)
    })
    .unwrap();
    let Ok(Some(lists)) = result else {
        panic!("credential schemes expected, got {result:?}");
    };
    let ids_of = |list: &[SchemeId]| -> Vec<String> {
        list.iter().map(|id| id.as_str().to_owned()).collect()
    };

    assert_eq!(reported, Vec::new());
    assert_eq!(ids_of(&lists.read), ["b", "\u{1F600}", "\u{ff5e}"]);
    assert_eq!(ids_of(&lists.write), Vec::<String>::new());
    assert_eq!(ids_of(&lists.optional_read), ["a", "z"]);
}

#[test]
fn a_credential_scheme_naming_an_undeclared_or_signature_scheme_is_reported() {
    let text = r#"{"identities":{"user":{"schemes":{"read":["ghost","sig"]}}}}"#;
    let kinds: HashMap<String, Option<String>> =
        HashMap::from([("sig".to_owned(), Some("signature".to_owned()))]);
    let headers = IndexMap::new();
    let schemas = seampact_ir::IrMap::new();
    let catalogues = AccessIdentityCatalogues {
        scheme_kinds: &kinds,
        headers: &headers,
        schemas: &schemas,
    };
    let (result, reported) = with_reporter(text, |reporter| {
        let raw = reporter.raw();
        let entries = access_identity_entries(&raw.merged, "identities");
        let Some(&(id, written)) = entries.first() else {
            return Ok(None);
        };
        let mut entry = IdentityEntry {
            id,
            pointer: "/identities/user".to_owned(),
            raw: written,
            catalogues: &catalogues,
            schemas: &FakeSchemaService::new(),
            reporter,
        };

        credential_members(&mut entry)
    })
    .unwrap();

    assert!(matches!(result, Ok(None)), "result {result:?}");

    let rules: Vec<&str> = reported.iter().map(|d| d.rule.as_str()).collect();

    assert_eq!(
        rules,
        [
            "seampact/access/scheme-reference",
            "seampact/access/scheme-kind"
        ]
    );
    assert_eq!(
        reported.first().map(|d| d.origin.pointer.as_str()),
        Some("/identities/user/schemes/read/0")
    );
}

const ACTOR_SURFACE_HEADER: &str = r#"{"headers":{"surface":{"semantic":"actorSurface","name":"x-surface","in":"request","schema":{}}}}"#;

#[test]
fn an_actor_surface_declaration_whose_schema_is_no_enum_is_refused_and_left_out() {
    let service = FakeSchemaService::new().with_type_use(
        "/headers/surface/schema",
        TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new("Surface".to_owned()),
            unknown_keys: None,
            nullable: None,
            docs: None,
            examples: None,
        }),
    );
    let (result, reported) = with_reporter(ACTOR_SURFACE_HEADER, |reporter| {
        access_identity_headers(&service, reporter).map(|headers| headers.len())
    })
    .unwrap();

    assert!(matches!(result, Ok(0)), "result {result:?}");

    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(
        diagnostic.rule.as_str(),
        "seampact/access/header-declaration"
    );
    assert_eq!(diagnostic.origin.pointer, "/headers/surface/schema");
}

#[test]
fn a_header_declaration_the_service_cannot_type_is_an_internal_error() {
    let (result, reported) = with_reporter(ACTOR_SURFACE_HEADER, |reporter| {
        access_identity_headers(&FakeSchemaService::new(), reporter).map(|headers| headers.len())
    })
    .unwrap();

    assert!(
        matches!(result, Err(PassError::Internal(_))),
        "result {result:?}"
    );
    assert_eq!(reported, Vec::new());
}
