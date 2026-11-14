//! Unit tests of the ported functions that read a context or a service the fixtures never fake,
//! and of the JavaScript behaviours they depend on (UTF-16 order, key order, placeholder counts).

use std::collections::HashMap;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_authoring::{ApiLayer, RawApi, RawLayer, RawWorkspace};
use seampact_diagnostics::{Diagnostic, DiagnosticSink};
use seampact_ir::{CallerKind, Direction, Layer, Origin, SchemeId, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{
    DraftIr, HalfContext, Inherited, PassError, TreeSchemaExampleIssue, TreeSchemaService,
    pipeline_conventions,
};

use crate::access::{access_identity_access_schemes, access_identity_caller_kinds};
use crate::identities::{
    AccessIdentityCatalogues, IdentityEntry, credential_members, is_header_use_for,
};
use crate::read::access_identity_entries;
use crate::report::{
    AccessIdentityProblem, AccessIdentityRelated, AccessIdentityReporter, AccessIdentityRule,
    access_identity_once_reporter, access_identity_reporter,
};
use crate::schema_use::access_identity_schema_use;
use crate::schemes::{
    access_identity_scheme_kinds, count_of, is_signature_encoding, placeholders_of,
};

struct SilentService;

impl TreeSchemaService for SilentService {
    fn type_use(
        &self,
        _pointer: &str,
        _direction: Direction,
    ) -> Result<Option<TypeUse>, PassError> {
        Ok(None)
    }

    fn query_wire(&self, _pointer: &str) -> Result<Option<seampact_ir::QueryWire>, PassError> {
        Ok(None)
    }

    fn check_example(
        &self,
        _value: &JsonValue,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(Vec::new())
    }

    fn check_text_example(
        &self,
        _text: &str,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(Vec::new())
    }
}

fn raw_api(text: &str) -> RawApi {
    let JsonValue::Object(merged) =
        serde_json::from_str::<JsonValue>(text).expect("the test text is JSON")
    else {
        panic!("the test text is not an object");
    };
    let mut leaf_origins = IndexMap::new();

    for (key, value) in &merged {
        collect_origins(value, &format!("/{key}"), &mut leaf_origins);
    }

    RawApi {
        name: "a".to_owned(),
        layers: vec![RawLayer {
            layer: ApiLayer::Api,
            file: "layer.yaml".to_owned(),
            tree: merged.clone(),
        }],
        merged,
        leaf_origins,
        locations: IndexMap::new(),
        visibility: IndexMap::new(),
    }
}

fn collect_origins(value: &JsonValue, pointer: &str, origins: &mut IndexMap<String, Origin>) {
    if let JsonValue::Object(object) = value
        && !object.is_empty()
    {
        for (key, item) in object {
            collect_origins(item, &format!("{pointer}/{key}"), origins);
        }

        return;
    }

    origins.insert(
        pointer.to_owned(),
        Origin {
            api: None,
            layer: Layer::Api,
            pointer: pointer.to_owned(),
        },
    );
}

// Runs `body` over a reporter of an api written as `text`, and answers what it reported.
fn with_reporter<R>(
    text: &str,
    body: impl FnOnce(&mut AccessIdentityReporter<'_, '_>) -> R,
) -> (R, Vec<Diagnostic>) {
    let raw = raw_api(text);
    let workspace = RawWorkspace {
        root: Utf8PathBuf::from("."),
        apis: vec![raw.clone()],
        locations: IndexMap::new(),
        entry: None,
        config: None,
    };
    let conventions = pipeline_conventions(&raw);
    let inherited = Inherited::new(&raw).expect("the test api has a tree");
    let relayed: IndexMap<String, DraftIr> = IndexMap::new();
    let imports = IndexMap::new();
    let mut sink = DiagnosticSink::new();
    let result = {
        let mut context = HalfContext::new(
            &raw,
            &workspace,
            &conventions,
            &inherited,
            &relayed,
            &imports,
            &mut sink,
        );
        let mut reporter = access_identity_reporter(&mut context);

        body(&mut reporter)
    };

    (result, sink.into_diagnostics())
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
    });

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
    });

    let message = result.err().unwrap_or_default();

    assert!(message.contains("/nowhere"), "message {message:?}");
    assert!(message.contains("has no origin"), "message {message:?}");
    assert_eq!(reported, Vec::new());
}

#[test]
fn the_once_reporter_reports_a_repeated_problem_once_and_counts_every_one() {
    let ((errors, base_errors), reported) = with_reporter(TWO_POINTERS, |base| {
        let mut once = access_identity_once_reporter(base);

        for _ in 0..3 {
            assert!(once.error(problem("/a/x")).is_ok());
        }

        assert!(once.error(problem("/b")).is_ok());

        (once.errors(), base.errors())
    });

    assert_eq!(errors, 4);
    assert_eq!(base_errors, 0);
    assert_eq!(reported.len(), 2);
}

#[test]
fn a_schema_the_service_does_not_answer_is_an_internal_error_naming_the_pointer() {
    let result = access_identity_schema_use(
        &SilentService,
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
fn signature_encodings_and_header_use_values_are_matched_exactly() {
    assert!(is_signature_encoding("hex"));
    assert!(is_signature_encoding("base64"));
    assert!(!is_signature_encoding("Hex"));
    assert!(!is_signature_encoding(""));
    assert!(is_header_use_for(Some("writes")));
    assert!(!is_header_use_for(Some("write")));
    assert!(!is_header_use_for(None));
}

#[test]
fn entries_come_in_javascript_key_order_and_skip_what_is_no_mapping() {
    let raw = raw_api(r#"{"schemes":{"b":{},"10":{},"2":{},"é":{},"a":{},"skipped":1}}"#);
    let names: Vec<&str> = access_identity_entries(&raw.merged, "schemes")
        .into_iter()
        .map(|(name, _)| name)
        .collect();

    assert_eq!(names, ["2", "10", "b", "\u{e9}", "a"]);
}

#[test]
fn scheme_kinds_are_kept_for_every_written_scheme() {
    let raw = raw_api(r#"{"schemes":{"a":{"kind":"basic"},"b":{}}}"#);
    let kinds = access_identity_scheme_kinds(&raw);

    assert_eq!(kinds.get("a"), Some(&Some("basic".to_owned())));
    assert_eq!(kinds.get("b"), Some(&None));
    assert_eq!(kinds.len(), 2);
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
            schemas: &SilentService,
            reporter,
        };

        credential_members(&mut entry)
    });
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
            schemas: &SilentService,
            reporter,
        };

        credential_members(&mut entry)
    });

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

#[test]
fn caller_kinds_follow_the_access_kind() {
    use seampact_ir::{Access, IdentityAccess, IdentityId, PublicAccess, Reason};

    let origin = Origin {
        api: None,
        layer: Layer::Api,
        pointer: "/x".to_owned(),
    };
    let public = Access::Public(PublicAccess {
        reason: Reason::new("open".to_owned()),
        origin: origin.clone(),
    });
    let identified = Access::Identity(IdentityAccess {
        identity: IdentityId::new("user".to_owned()),
        schemes: vec![SchemeId::new("token".to_owned())],
        origin,
    });

    assert_eq!(
        access_identity_caller_kinds(&public),
        Ok(vec![CallerKind::Anonymous])
    );
    assert_eq!(
        access_identity_caller_kinds(&identified),
        Ok(vec![CallerKind::Identified])
    );
    assert_eq!(access_identity_access_schemes(&public), Ok(None));
    assert_eq!(
        access_identity_access_schemes(&identified).map(|schemes| schemes.map(<[SchemeId]>::len)),
        Ok(Some(1))
    );
}
