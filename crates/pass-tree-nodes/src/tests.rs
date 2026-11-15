//! Unit tests of the ported functions the converted fixtures never reach, and of the JavaScript
//! behaviours they depend on (regex edges, key order, number text).

use std::error::Error;

use seampact_ir::{
    FieldWireKind, KnownApiVersion, LabelApiVersion, PathApiVersion, PathVersionMode, QueryStyle,
    QueryWire, QueryWireKind, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;
use seampact_pipeline::testing::FakeSchemaService;

use crate::api::{
    is_literal_version_segment, leading_slash, literal_number, one_of, resolve_prefix, text_of,
    trim_trailing_slash,
};
use crate::field_wire::{tree_nodes_field_wire, tree_nodes_is_file_field};
use crate::lifecycle::extension_key_parts;
use crate::pagings::sent_key;
use seampact_ir::PagingParamPlacement;

use crate::params::{blank_placeholders, placeholders_of};

fn type_use(text: &str) -> Result<TypeUse, serde_json::Error> {
    serde_json::from_str(text)
}

const FILE: &str = r#"{"kind":"file","media":[]}"#;
const OPAQUE_LIST: &str = r#"{"kind":"array","items":{"kind":"opaque","reason":"unknown","origin":{"layer":"api","pointer":"/x"}}}"#;

#[test]
fn a_file_or_a_list_of_files_has_the_file_wire_without_asking_the_service()
-> Result<(), Box<dyn Error>> {
    let files = type_use(r#"{"kind":"array","items":{"kind":"file","media":[]}}"#)?;
    let service = FakeSchemaService::new();

    assert!(tree_nodes_is_file_field(&files));

    for field in [type_use(FILE)?, files] {
        let wire = tree_nodes_field_wire("/schemas/A/properties/f", &field, &service)?;

        assert_eq!(wire.kind, FieldWireKind::File);
        assert_eq!(wire.style, None);
    }

    Ok(())
}

#[test]
fn a_field_the_service_has_no_wire_for_is_an_internal_fault() -> Result<(), serde_json::Error> {
    let service = FakeSchemaService::new();
    let outcome = tree_nodes_field_wire("/a/input/properties/x", &type_use(OPAQUE_LIST)?, &service);

    assert!(
        matches!(outcome, Err(PassError::Internal(_))),
        "{outcome:?}"
    );

    Ok(())
}

#[test]
fn a_field_wire_from_the_service_carries_its_style() -> Result<(), Box<dyn Error>> {
    let service = FakeSchemaService::new().with_query_wire(
        "/a/input/properties/x",
        QueryWire {
            kind: QueryWireKind::List,
            style: QueryStyle::Form,
            explode: true,
            brackets: false,
        },
    );
    let wire = tree_nodes_field_wire("/a/input/properties/x", &type_use(OPAQUE_LIST)?, &service)?;

    assert_eq!(wire.kind, FieldWireKind::List);
    assert_eq!(wire.explode, Some(true));
    assert_eq!(wire.brackets, Some(false));

    Ok(())
}

#[test]
fn placeholders_follow_the_regex_edges() {
    assert_eq!(placeholders_of("/a/{id}/b/{id}/{c}"), ["id", "id", "c"]);
    assert_eq!(placeholders_of("/a/{}/b"), Vec::<&str>::new());
    assert_eq!(placeholders_of("{a{b}"), ["b"]);
    assert_eq!(placeholders_of("{{a}}"), ["a"]);
    assert_eq!(placeholders_of("/x/{open"), Vec::<&str>::new());
    assert_eq!(placeholders_of("{a\nb}"), ["a\nb"]);
}

#[test]
fn a_route_key_blanks_each_placeholder_by_position() {
    assert_eq!(
        blank_placeholders("/tasks/{id}"),
        blank_placeholders("/tasks/{taskId}")
    );
    assert_eq!(blank_placeholders("/tasks/{id}/x/{}"), "/tasks/{}/x/{}");
    assert_eq!(blank_placeholders("/tasks/me"), "/tasks/me");
    assert_eq!(blank_placeholders("{a{b}"), "{a{}");
}

#[test]
fn an_extension_key_needs_a_lowercase_prefix_and_a_one_line_name() {
    assert_eq!(extension_key_parts("x-acme-flag"), Some(("acme", "flag")));
    assert_eq!(extension_key_parts("x-a1-b-c"), Some(("a1", "b-c")));
    assert_eq!(
        extension_key_parts("x-acme-__proto__"),
        Some(("acme", "__proto__"))
    );
    assert_eq!(extension_key_parts("x-acme-"), None);
    assert_eq!(extension_key_parts("x-Acme-flag"), None);
    assert_eq!(extension_key_parts("x-1a-flag"), None);
    assert_eq!(extension_key_parts("x-acme-a\nb"), None);
    assert_eq!(extension_key_parts("acme-flag"), None);
}

#[test]
fn a_literal_version_segment_is_v_and_digits_only() {
    assert!(is_literal_version_segment("v1"));
    assert!(is_literal_version_segment("v007"));
    assert!(!is_literal_version_segment("v"));
    assert!(!is_literal_version_segment("V1"));
    assert!(!is_literal_version_segment("v1a"));
    assert_eq!(literal_number("v007"), Some("7".to_owned()));
    assert_eq!(
        literal_number("v12345678901234567890"),
        Some("12345678901234567000".to_owned())
    );
}

#[test]
fn a_prefix_resolves_against_its_path_version() {
    let path = KnownApiVersion::Path(PathApiVersion { number: 2 });
    let label = KnownApiVersion::Label(LabelApiVersion {
        label: "beta".to_owned(),
    });

    assert_eq!(
        resolve_prefix("app/", &PathVersionMode::Prefix, &path),
        "/v2/app"
    );
    assert_eq!(
        resolve_prefix("/x/{version}/y/", &PathVersionMode::Prefix, &path),
        "/x/2/y"
    );
    assert_eq!(resolve_prefix("", &PathVersionMode::Prefix, &path), "/v2");
    assert_eq!(
        resolve_prefix("{version}", &PathVersionMode::Prefix, &label),
        "/beta"
    );
    assert_eq!(resolve_prefix("v1/", &PathVersionMode::None, &path), "/v1");
    assert_eq!(resolve_prefix("", &PathVersionMode::None, &path), "");
    assert_eq!(leading_slash("a"), "/a");
    assert_eq!(trim_trailing_slash("/a//"), "/a/");
}

#[test]
fn a_written_value_matches_only_by_its_exact_text() {
    let kinds = [seampact_ir::ApiKind::Product, seampact_ir::ApiKind::Service];
    let service = JsonValue::String("service".to_owned());
    let number = JsonValue::Bool(true);

    assert_eq!(
        one_of(Some(&service), &kinds, seampact_ir::ApiKind::as_str),
        Some(seampact_ir::ApiKind::Service)
    );
    assert_eq!(
        one_of(
            Some(&JsonValue::String("Service".to_owned())),
            &kinds,
            seampact_ir::ApiKind::as_str
        ),
        None
    );
    assert_eq!(
        one_of(Some(&number), &kinds, seampact_ir::ApiKind::as_str),
        None
    );
    assert_eq!(one_of(None, &kinds, seampact_ir::ApiKind::as_str), None);
    assert_eq!(text_of(Some(&number)), None);
}

#[test]
fn a_header_placement_lowercases_the_sent_name_and_a_query_keeps_it() {
    assert_eq!(
        sent_key(&PagingParamPlacement::Header, "X-Page"),
        r#"["header","x-page"]"#
    );
    assert_eq!(
        sent_key(&PagingParamPlacement::Query, "Page"),
        r#"["query","Page"]"#
    );
}
