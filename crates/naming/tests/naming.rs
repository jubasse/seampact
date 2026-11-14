//! The ported cases of the TypeScript naming tests, run over the shared vectors.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    reason = "test code: a failed lookup is the failed test"
)]

use std::collections::HashMap;

use seampact_naming::{
    CanonicalIdOptions, Escape, EscapePosition, IdentifierOptions, LANGUAGES, Language, Name,
    NameSource, NamingError, OperationIdCase, ROLES, Role, SegmentsOptions, SegmentsResult, Style,
    SuffixRole, Suffixes, assert_language, assert_role, canonical_id, derive_name, identifier,
    is_reserved, is_type_role, operation_id, segments_of, split_name, suffix_words,
};
use serde::Deserialize;

const VECTORS: &str = include_str!("../../../packages/core/spec/vectors/naming/vectors.json");
const RESERVED: &str =
    include_str!("../../../packages/core/spec/vectors/naming/reserved-words.json");

#[derive(Deserialize)]
struct OperationIds {
    camel: String,
    snake: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    id: String,
    category: String,
    role: String,
    source: Option<String>,
    written: Option<String>,
    code_name: Option<String>,
    position: Option<usize>,
    owner: Option<Vec<String>>,
    status: Option<i64>,
    segments: Option<Vec<String>>,
    error: Option<String>,
    expected: Option<HashMap<String, Option<String>>>,
    canonical_id: Option<String>,
    operation_id: Option<OperationIds>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReservedList {
    used_by: Vec<String>,
    case_insensitive: bool,
    keywords: Vec<String>,
    types: Vec<String>,
    members: Vec<String>,
    enum_members: Vec<String>,
}

#[derive(Deserialize)]
struct ReservedFile {
    lists: HashMap<String, ReservedList>,
}

type Checked<T> = Result<T, NamingError>;

fn vectors() -> Vec<Vector> {
    serde_json::from_str(VECTORS).expect("vectors.json parses")
}

fn reserved() -> ReservedFile {
    serde_json::from_str(RESERVED).expect("reserved-words.json parses")
}

fn words(list: &[&str]) -> Vec<String> {
    list.iter().map(|word| (*word).to_owned()).collect()
}

fn role(text: &str) -> Role {
    assert_role(text).expect("a known role")
}

fn name(segments: &[&str], role: Role, status: Option<i64>) -> Name {
    derive_name(&words(segments), role, status).expect("a well formed name")
}

fn id_of(name: &Name, language: Language) -> Option<String> {
    identifier(name, language, &IdentifierOptions::default()).expect("an identifier")
}

fn id_with(
    name: &Name,
    language: Language,
    options: &IdentifierOptions,
) -> Checked<Option<String>> {
    identifier(name, language, options)
}

fn source_of(text: &str) -> NameSource {
    match text {
        "name" => NameSource::Name,
        "enumValue" => NameSource::EnumValue,
        "right" => NameSource::Right,
        other => panic!("unknown source {other}"),
    }
}

/// The mismatches of one vector against the implementation, empty when it passes.
fn check(vector: &Vector) -> Vec<String> {
    let mut problems = Vec::new();
    let result = match &vector.owner {
        Some(owner) => SegmentsResult::Segments(owner.clone()),
        None => segments_of(
            vector.written.as_deref().expect("a written name"),
            source_of(vector.source.as_deref().expect("a source")),
            &SegmentsOptions {
                code_name: vector.code_name.clone(),
                position: vector.position,
            },
        )
        .expect("segments"),
    };

    if let Some(error) = &vector.error {
        match result {
            SegmentsResult::Segments(found) => {
                problems.push(format!(
                    "{}: expected error {error}, got {found:?}",
                    vector.id
                ));
            }
            SegmentsResult::NoSegment if error != "no-segment" => {
                problems.push(format!("{}: reason no-segment", vector.id));
            }
            SegmentsResult::NoSegment => {}
        }

        return problems;
    }

    let SegmentsResult::Segments(segments) = result else {
        return vec![format!("{}: unexpected error no-segment", vector.id)];
    };

    assert_eq!(Some(&segments), vector.segments.as_ref(), "{}", vector.id);

    let derived = derive_name(&segments, role(&vector.role), vector.status).expect("a name");

    for language in LANGUAGES {
        let got = id_of(&derived, language);
        let want = vector
            .expected
            .as_ref()
            .and_then(|expected| expected.get(language.as_str()))
            .cloned()
            .flatten();

        if got != want {
            problems.push(format!(
                "{} {}: expected {want:?}, got {got:?}",
                vector.id,
                language.as_str()
            ));
        }
    }

    let canonical = canonical_id(&derived, CanonicalIdOptions::default()).expect("a canonical id");

    if let Some(want) = &vector.canonical_id
        && canonical.as_ref() != Some(want)
    {
        problems.push(format!(
            "{} canonicalId: expected {want}, got {canonical:?}",
            vector.id
        ));
    }

    if let Some(ids) = &vector.operation_id {
        for (id_case, want) in [
            (OperationIdCase::Camel, &ids.camel),
            (OperationIdCase::Snake, &ids.snake),
        ] {
            let got = canonical_id(
                &derived,
                CanonicalIdOptions {
                    operation_id_case: id_case,
                },
            )
            .expect("a canonical id");

            if got.as_ref() != Some(want) {
                problems.push(format!("{} {id_case:?}: got {got:?}", vector.id));
            }
        }
    }

    problems
}

fn find(all: &[Vector], id: &str) -> usize {
    all.iter()
        .position(|vector| vector.id == id)
        .expect("vector present")
}

fn expected_of<'a>(vector: &'a Vector, language: &str) -> Option<&'a str> {
    vector.expected.as_ref()?.get(language)?.as_deref()
}

#[test]
fn adr_0007_examples() {
    assert_eq!(split_name("userId"), ["user", "id"]);
    assert_eq!(split_name("HTTPServer"), ["http", "server"]);
    assert_eq!(split_name("userID"), ["user", "id"]);
    assert_eq!(split_name("oauth2Token"), ["oauth2", "token"]);
    assert_eq!(split_name("v2"), ["v2"]);

    let table: [(&[&str], Role, &str, Option<i64>); 12] = [
        (&["assign", "task"], Role::Input, "AssignTaskInput", None),
        (
            &["create", "task"],
            Role::Response,
            "CreateTaskResponse201",
            Some(201),
        ),
        (&["list", "tasks"], Role::Query, "ListTasksQuery", None),
        (
            &["tasks", "update"],
            Role::Params,
            "TasksUpdateParams",
            None,
        ),
        (
            &["api", "rate", "limited"],
            Role::Params,
            "ApiRateLimitedParams",
            None,
        ),
        (&["tasks", "locked"], Role::Error, "TasksLockedError", None),
        (&["update", "task"], Role::Errors, "UpdateTaskErrors", None),
        (&["1042"], Role::Params, "_1042Params", None),
        (&["order", "address"], Role::Property, "OrderAddress", None),
        (
            &["notice", "assigned"],
            Role::Variant,
            "NoticeAssigned",
            None,
        ),
        (&["tasks"], Role::Endpoints, "TasksEndpoints", None),
        (&["assign", "task"], Role::Operation, "assignTask", None),
    ];
    let all = vectors();

    for (owner, table_role, expected, status) in table {
        let derived = name(owner, table_role, status);

        for language in LANGUAGES {
            assert_eq!(id_of(&derived, language).as_deref(), Some(expected));
        }

        assert_eq!(
            canonical_id(&derived, CanonicalIdOptions::default())
                .expect("id")
                .as_deref(),
            Some(expected)
        );
        assert!(
            all.iter()
                .any(|vector| vector.owner.as_deref() == Some(&words(owner)[..])
                    && vector.role == table_role.as_str()
                    && expected_of(vector, "php") == Some(expected)),
            "vector for {expected}"
        );
    }

    let list = name(&["list"], Role::Schema, None);
    let listed: Vec<Option<String>> = LANGUAGES
        .iter()
        .map(|language| id_of(&list, *language))
        .collect();

    assert_eq!(
        listed,
        ["List", "List_", "List_", "List_"].map(|text| Some(text.to_owned()))
    );

    let schema_list = &all[find(&all, "reserved/schema-list")];

    assert_eq!(schema_list.segments, Some(words(&["list"])));
    for (language, want) in [
        ("typescript", "List"),
        ("kotlin", "List_"),
        ("java", "List_"),
        ("php", "List_"),
        ("python", "List"),
    ] {
        assert_eq!(expected_of(schema_list, language), Some(want));
    }
}

#[test]
fn vectors_pass_for_every_language() {
    let all = vectors();

    assert!(all.len() > 100);

    let problems: Vec<String> = all.iter().flat_map(check).collect();

    assert_eq!(problems, Vec::<String>::new());
}

#[test]
fn vector_ids_are_unique_and_sorted_by_code_unit() {
    let ids: Vec<String> = vectors().into_iter().map(|vector| vector.id).collect();
    let mut sorted = ids.clone();

    sorted.sort();
    sorted.dedup();

    assert_eq!(ids, sorted);
}

#[test]
fn reserved_words_file_is_sorted_and_names_each_language_once() {
    let file = reserved();
    let mut served: Vec<&str> = file
        .lists
        .values()
        .flat_map(|list| list.used_by.iter().map(String::as_str))
        .collect();

    served.sort_unstable();

    assert_eq!(served, ["java", "kotlin", "php", "python", "typescript"]);

    for (language, list) in &file.lists {
        assert_eq!(list.used_by, std::slice::from_ref(language));

        for group in [
            &list.keywords,
            &list.types,
            &list.members,
            &list.enum_members,
        ] {
            let mut sorted = group.clone();

            sorted.sort();
            sorted.dedup();

            assert_eq!(group, &sorted, "{language}");

            if list.case_insensitive {
                assert!(
                    group.iter().all(|word| *word == word.to_lowercase()),
                    "{language} is lowercase"
                );
            }
        }
    }
}

#[test]
fn vectors_cover_the_required_cases() {
    let all = vectors();

    for category in [
        "splitting",
        "digits",
        "enum-fallback",
        "right",
        "reserved",
        "php-case",
        "derived",
    ] {
        assert!(
            all.iter().any(|vector| vector.category == category),
            "{category}"
        );
    }

    for covered in ROLES
        .iter()
        .filter(|candidate| !matches!(candidate, Role::Schema | Role::EnumMember))
    {
        assert!(
            all.iter()
                .any(|vector| vector.category == "derived" && vector.role == covered.as_str()),
            "derived role {}",
            covered.as_str()
        );
    }

    for word in ["list", "match", "record", "error", "promise"] {
        assert!(
            all.iter().any(|vector| vector.role == "schema"
                && vector.category == "reserved"
                && vector.written.as_deref() == Some(word)),
            "{word}"
        );
    }

    let at = |id: &str| &all[find(&all, id)];

    assert_eq!(
        expected_of(at("digits/error-code-params-1042"), "php"),
        Some("_1042Params")
    );
    assert_eq!(
        expected_of(at("digits/error-code-error-404-gone"), "kotlin"),
        Some("_404GoneError")
    );
    assert_eq!(
        at("enum-fallback/plus-at-3").segments,
        Some(words(&["value3"]))
    );
    assert_eq!(
        at("right/star-without-codeName").error.as_deref(),
        Some("no-segment")
    );
    assert_eq!(
        at("right/star-with-codeName").segments,
        Some(words(&["wildcard"]))
    );

    let operation = at("derived/operation-list-tasks")
        .operation_id
        .as_ref()
        .expect("operation ids");

    assert_eq!(
        (operation.camel.as_str(), operation.snake.as_str()),
        ("listTasks", "list_tasks")
    );
}

#[test]
fn reserved_words_escaped() {
    let cases = [
        ("list", Role::Schema, Language::Kotlin, "List_"),
        ("error", Role::Schema, Language::TypeScript, "Error_"),
        ("record", Role::Schema, Language::Java, "Record_"),
        ("promise", Role::Schema, Language::TypeScript, "Promise_"),
        ("promise", Role::Schema, Language::Kotlin, "Promise"),
        ("class", Role::Member, Language::TypeScript, "class_"),
        ("delete", Role::Member, Language::TypeScript, "delete_"),
        ("delete", Role::Member, Language::Java, "delete"),
        ("val", Role::Member, Language::Kotlin, "val_"),
        ("val", Role::Member, Language::Java, "val"),
        ("let", Role::Member, Language::TypeScript, "let_"),
    ];

    for (word, case_role, language, expected) in cases {
        assert_eq!(
            id_of(&name(&[word], case_role, None), language).as_deref(),
            Some(expected),
            "{word} {}",
            language.as_str()
        );
    }

    assert_eq!(
        is_reserved("Error", Language::TypeScript, Role::Schema),
        Ok(true)
    );
    assert_eq!(
        is_reserved("Error", Language::TypeScript, Role::Member),
        Ok(false)
    );
    assert_eq!(
        is_reserved("class", Language::TypeScript, Role::Member),
        Ok(true)
    );

    // Every listed word is reserved for the roles it applies to, with the casing of its list.
    let file = reserved();

    for language in LANGUAGES {
        let list = file.lists.get(language.as_str()).expect("a list");

        for word in &list.keywords {
            for every in ROLES {
                assert_eq!(
                    is_reserved(word, language, every),
                    Ok(true),
                    "{word} {}",
                    every.as_str()
                );
            }
        }

        for (group, group_role) in [
            (&list.types, Role::Schema),
            (&list.members, Role::Member),
            (&list.enum_members, Role::EnumMember),
        ] {
            for word in group {
                assert_eq!(is_reserved(word, language, group_role), Ok(true), "{word}");
            }
        }
    }

    let php =
        |segments: &[&str], php_role: Role| id_of(&name(segments, php_role, None), Language::Php);

    assert_eq!(php(&["list"], Role::Member).as_deref(), Some("list"));
    assert_eq!(php(&["list"], Role::EnumMember).as_deref(), Some("List"));
    assert_eq!(php(&["class"], Role::EnumMember).as_deref(), Some("Class_"));
    assert_eq!(php(&["this"], Role::Member).as_deref(), Some("this_"));

    let member = |segments: &[&str], language: Language| {
        id_of(&name(segments, Role::Member, None), language)
    };

    assert_eq!(
        member(&["hash", "code"], Language::Java).as_deref(),
        Some("hashCode_")
    );
    assert_eq!(
        member(&["hash", "code"], Language::Kotlin).as_deref(),
        Some("hashCode")
    );
    assert_eq!(member(&["val"], Language::Java).as_deref(), Some("val"));
    assert_eq!(member(&["val"], Language::Kotlin).as_deref(), Some("val_"));
    assert_eq!(
        id_of(&name(&["optional"], Role::Schema, None), Language::Kotlin).as_deref(),
        Some("Optional")
    );
    assert_eq!(
        id_of(&name(&["optional"], Role::Schema, None), Language::Java).as_deref(),
        Some("Optional_")
    );
    assert_eq!(
        member(&["constructor"], Language::TypeScript).as_deref(),
        Some("constructor_")
    );
}

#[test]
fn php_compares_reserved_names_case_insensitively() {
    for word in ["list", "LIST", "List", "lIsT", "Fn", "FN", "Match", "ARRAY"] {
        assert_eq!(
            is_reserved(word, Language::Php, Role::Schema),
            Ok(true),
            "{word}"
        );
    }

    assert_eq!(
        is_reserved("LIST", Language::Kotlin, Role::Schema),
        Ok(false)
    );
    assert_eq!(
        is_reserved("Class", Language::TypeScript, Role::Member),
        Ok(false)
    );

    for written in ["list", "LIST", "List"] {
        let derived = derive_name(&split_name(written), Role::Schema, None).expect("a name");

        assert_eq!(id_of(&derived, Language::Php).as_deref(), Some("List_"));
    }

    assert_eq!(
        id_of(&name(&["class"], Role::EnumMember, None), Language::Php).as_deref(),
        Some("Class_")
    );
    assert!(
        reserved()
            .lists
            .get("php")
            .is_some_and(|list| list.case_insensitive)
    );
}

#[test]
fn digit_led_identifiers() {
    assert_eq!(
        id_of(&name(&["2fa"], Role::Member, None), Language::TypeScript).as_deref(),
        Some("_2fa")
    );
    assert_eq!(
        id_of(&name(&["2fa"], Role::EnumMember, None), Language::Kotlin).as_deref(),
        Some("_2FA")
    );
    assert_eq!(
        id_of(
            &name(&["2fa"], Role::EnumMember, None),
            Language::TypeScript
        ),
        None
    );
    assert_eq!(
        id_of(&name(&["1042"], Role::Params, None), Language::Php).as_deref(),
        Some("_1042Params")
    );
    assert_eq!(
        id_of(&name(&["404", "gone"], Role::Error, None), Language::Java).as_deref(),
        Some("_404GoneError")
    );
    assert_eq!(
        id_of(
            &name(&["404", "gone"], Role::Schema, None),
            Language::TypeScript
        )
        .as_deref(),
        Some("_404Gone")
    );

    for every in ROLES {
        for language in LANGUAGES {
            let status = (every == Role::Response).then_some(200);
            let got = id_of(&name(&["7up"], every, status), language);

            if let Some(text) = got {
                assert!(
                    text.starts_with("_7"),
                    "{} {}",
                    every.as_str(),
                    language.as_str()
                );
            }
        }
    }

    assert_eq!(
        operation_id(&words(&["2fa", "verify"]), OperationIdCase::Camel).as_deref(),
        Ok("2faVerify")
    );
}

#[test]
fn right_without_segments() {
    let none = SegmentsOptions::default();
    let named = |code_name: &str, position: Option<usize>| SegmentsOptions {
        code_name: Some(code_name.to_owned()),
        position,
    };

    assert_eq!(
        segments_of("*", NameSource::Right, &none),
        Ok(SegmentsResult::NoSegment)
    );
    assert_eq!(
        segments_of("*", NameSource::Right, &named("wildcard", None)),
        Ok(SegmentsResult::Segments(words(&["wildcard"])))
    );
    assert_eq!(
        segments_of("*", NameSource::Right, &named("*", None)),
        Ok(SegmentsResult::NoSegment)
    );
    // A codeName without segment is an error for an enum value too, never the fallback.
    assert_eq!(
        segments_of("ok", NameSource::EnumValue, &named("+", Some(2))),
        Ok(SegmentsResult::NoSegment)
    );
    assert_eq!(
        segments_of("tasks.update", NameSource::Right, &none),
        Ok(SegmentsResult::Segments(words(&["tasks", "update"])))
    );
    assert_eq!(
        segments_of(
            "+",
            NameSource::EnumValue,
            &SegmentsOptions {
                code_name: None,
                position: Some(3)
            }
        ),
        Ok(SegmentsResult::Segments(words(&["value3"])))
    );
    assert_eq!(
        segments_of("+", NameSource::Name, &none),
        Ok(SegmentsResult::NoSegment)
    );

    // An enum value needs a positive position.
    for position in [None, Some(0)] {
        let error = segments_of(
            "+",
            NameSource::EnumValue,
            &SegmentsOptions {
                code_name: None,
                position,
            },
        )
        .expect_err("refused");

        assert!(error.to_string().contains("position"), "{error}");
    }

    let error = segments_of("active", NameSource::EnumValue, &none).expect_err("refused");

    assert!(error.to_string().contains("position"));
}

#[test]
fn split_name_is_total_and_yields_only_valid_segments() {
    let mut samples: Vec<String> = [
        "",
        "---",
        "A",
        "aA",
        "AAa",
        "a1A",
        "é",
        "\u{0}x",
        "İstanbul",
        "ǅ",
        &"x".repeat(50),
    ]
    .iter()
    .map(|sample| (*sample).to_owned())
    .collect();
    let alphabet: Vec<char> = "aAzZ09_-. éİ\n".chars().collect();
    let mut seed: u32 = 7;

    for _ in 0..500 {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345) & 0x7fff_ffff;

        let length = seed % 12;
        let mut sample = String::new();

        for _ in 0..length {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345) & 0x7fff_ffff;
            sample.push(alphabet[(seed as usize) % alphabet.len()]);
        }

        samples.push(sample);
    }

    for sample in &samples {
        for segment in split_name(sample) {
            assert!(
                !segment.is_empty()
                    && segment
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
                "{sample:?}"
            );
        }
    }
}

#[test]
fn split_name_ignores_non_ascii_and_astral_letters() {
    assert_eq!(split_name("İstanbul"), ["stanbul"]);
    assert_eq!(split_name("café"), ["caf"]);
    assert_eq!(split_name("a😀B"), ["a", "b"]);
    assert_eq!(split_name("ǅa"), ["a"]);
    assert_eq!(split_name("a\nb"), ["a", "b"]);
    assert_eq!(split_name("ABc"), ["a", "bc"]);
    assert_eq!(split_name("a1B"), ["a1", "b"]);
}

#[test]
fn response_suffix_carries_the_status() {
    assert_eq!(
        suffix_words(&name(&["create", "task"], Role::Response, Some(201)), None),
        Ok(words(&["response", "201"]))
    );
    assert_eq!(
        suffix_words(&name(&["create", "task"], Role::Input, None), None),
        Ok(words(&["input"]))
    );
    assert_eq!(
        suffix_words(&name(&["order", "address"], Role::Property, None), None),
        Ok(Vec::new())
    );
}

#[test]
fn status_is_present_exactly_for_a_response_and_within_range() {
    let created = name(&["create", "task"], Role::Response, Some(201));

    assert_eq!(
        created,
        Name {
            segments: words(&["create", "task"]),
            role: Role::Response,
            status: Some(201)
        }
    );
    assert_eq!(name(&["create", "task"], Role::Input, None).status, None);

    let bad = |segments: &[&str], status_role: Role, status: Option<i64>| {
        derive_name(&words(segments), status_role, status)
    };

    assert!(
        bad(&["a"], Role::Response, None)
            .expect_err("refused")
            .to_string()
            .contains("status")
    );

    for status in [-1, 0, 100, 199, 400, 404, 599, 600] {
        assert!(
            bad(&["a"], Role::Response, Some(status))
                .expect_err("refused")
                .to_string()
                .contains("status"),
            "{status}"
        );
    }

    for status in [200, 204, 399] {
        assert!(
            bad(&["a"], Role::Response, Some(status)).is_ok(),
            "{status}"
        );
    }

    assert!(
        bad(&["a"], Role::Input, Some(200))
            .expect_err("refused")
            .to_string()
            .contains("no status")
    );

    // A hand-built name is checked by identifier, canonical_id and suffix_words too.
    let forged = [
        Name {
            segments: words(&["a"]),
            role: Role::Response,
            status: None,
        },
        Name {
            segments: words(&["a"]),
            role: Role::Response,
            status: Some(0),
        },
        Name {
            segments: words(&["a"]),
            role: Role::Input,
            status: Some(200),
        },
    ];

    for each in &forged {
        let checks = [
            identifier(each, Language::TypeScript, &IdentifierOptions::default()).map(|_| ()),
            canonical_id(each, CanonicalIdOptions::default()).map(|_| ()),
            suffix_words(each, None).map(|_| ()),
        ];

        for check in checks {
            assert!(
                check.expect_err("refused").to_string().contains("status"),
                "{each:?}"
            );
        }
    }
}

#[test]
fn fails_closed_on_a_malformed_name() {
    for segments in [
        &["Task"][..],
        &["a b"],
        &["a_b"],
        &[""],
        &["é"],
        &["a\n"],
        &["ａ"],
    ] {
        let error = derive_name(&words(segments), Role::Schema, None).expect_err("refused");

        assert!(error.to_string().contains("segment"), "{segments:?}");

        let forged = Name {
            segments: words(segments),
            role: Role::Schema,
            status: None,
        };

        assert!(identifier(&forged, Language::TypeScript, &IdentifierOptions::default()).is_err());
    }

    assert!(
        operation_id(&words(&["List"]), OperationIdCase::Camel)
            .expect_err("refused")
            .to_string()
            .contains("segment")
    );
    assert!(operation_id(&[], OperationIdCase::Camel).is_err());

    let empty_schema = identifier(
        &name(&[], Role::Schema, None),
        Language::TypeScript,
        &IdentifierOptions::default(),
    );

    assert!(
        empty_schema
            .expect_err("refused")
            .to_string()
            .contains("without segment")
    );
    let empty_member = identifier(
        &name(&[], Role::Member, None),
        Language::Php,
        &IdentifierOptions::default(),
    );

    assert!(
        empty_member
            .expect_err("refused")
            .to_string()
            .contains("without segment")
    );
    assert_eq!(
        id_of(&name(&[], Role::Endpoints, None), Language::TypeScript).as_deref(),
        Some("Endpoints")
    );

    assert!(
        assert_role("widget")
            .expect_err("refused")
            .to_string()
            .contains("\"widget\"")
    );
    assert!(
        derive_name(
            &words(&["a"]),
            "widget".parse().unwrap_or(Role::Schema),
            None
        )
        .is_ok()
    );

    for language in ["go", "constructor", "__proto__", ""] {
        assert!(
            assert_language(language)
                .expect_err("refused")
                .to_string()
                .contains("language"),
            "{language}"
        );
    }

    // An inherited property name is no suffix override.
    assert!(suffix_words(&name(&["a"], Role::Input, None), Some(&Suffixes::new())).is_ok());
}

#[test]
fn is_type_role_classifies_every_role() {
    for every in ROLES {
        let is_type = !matches!(every, Role::Operation | Role::Member | Role::EnumMember);

        assert_eq!(is_type_role(every), is_type, "{}", every.as_str());
    }
}

#[test]
fn options_seam_suffixes_escape_and_enum_case() {
    let input = name(&["assign", "task"], Role::Input, None);
    let with_suffix = |word: &str| IdentifierOptions {
        suffixes: Some(Suffixes::new().with(SuffixRole::Input, word)),
        ..IdentifierOptions::default()
    };
    let escape = |position: EscapePosition, text: &str| IdentifierOptions {
        escape: Some(Escape {
            position,
            text: text.to_owned(),
        }),
        ..IdentifierOptions::default()
    };
    let enum_case = |style: Style| IdentifierOptions {
        enum_case: Some(style),
        ..IdentifierOptions::default()
    };
    let some = |text: &str| Ok(Some(text.to_owned()));

    assert_eq!(
        id_with(&input, Language::Java, &with_suffix("dto")),
        some("AssignTaskDto")
    );
    assert_eq!(
        id_with(&input, Language::TypeScript, &with_suffix("request")),
        some("AssignTaskRequest")
    );

    let reply = IdentifierOptions {
        suffixes: Some(Suffixes::new().with(SuffixRole::Response, "reply")),
        ..IdentifierOptions::default()
    };

    assert_eq!(
        id_with(
            &name(&["create", "task"], Role::Response, Some(201)),
            Language::Php,
            &reply
        ),
        some("CreateTaskReply201")
    );
    assert_eq!(
        id_with(&input, Language::Kotlin, &IdentifierOptions::default()),
        Ok(id_of(&input, Language::Kotlin))
    );

    let list = name(&["list"], Role::Schema, None);

    assert_eq!(
        id_with(&list, Language::Java, &escape(EscapePosition::Prefix, "_")),
        some("_List")
    );
    assert_eq!(
        id_with(
            &list,
            Language::Java,
            &escape(EscapePosition::Suffix, "Type")
        ),
        some("ListType")
    );
    assert_eq!(
        id_with(
            &name(&["class"], Role::Member, None),
            Language::TypeScript,
            &escape(EscapePosition::Prefix, "my")
        ),
        some("myclass")
    );

    let in_progress = name(&["in", "progress"], Role::EnumMember, None);

    assert_eq!(
        id_with(&in_progress, Language::Kotlin, &enum_case(Style::Pascal)),
        some("InProgress")
    );
    assert_eq!(
        id_with(&in_progress, Language::Php, &enum_case(Style::UpperSnake)),
        some("IN_PROGRESS")
    );
    assert_eq!(
        id_with(&in_progress, Language::Java, &enum_case(Style::Camel)),
        some("inProgress")
    );
    assert_eq!(
        id_with(
            &in_progress,
            Language::TypeScript,
            &enum_case(Style::Pascal)
        ),
        Ok(None)
    );
    assert_eq!(
        id_with(
            &name(&["class"], Role::EnumMember, None),
            Language::Kotlin,
            &enum_case(Style::Camel)
        ),
        some("class_")
    );

    for word in ["Dto", ""] {
        assert!(
            id_with(&input, Language::Java, &with_suffix(word))
                .expect_err("refused")
                .to_string()
                .contains("suffix"),
            "{word:?}"
        );
    }

    assert!(
        id_with(&input, Language::Java, &escape(EscapePosition::Suffix, ""))
            .expect_err("refused")
            .to_string()
            .contains("escape")
    );
    assert!(
        id_with(
            &input,
            Language::Java,
            &escape(EscapePosition::Suffix, "a-b")
        )
        .is_err()
    );
    assert!(
        id_with(
            &input,
            Language::Java,
            &escape(EscapePosition::Prefix, "1x")
        )
        .expect_err("refused")
        .to_string()
        .contains("digit")
    );
}

#[test]
fn operation_id_casing() {
    let segments = words(&["list", "tasks"]);

    assert_eq!(
        operation_id(&segments, OperationIdCase::Camel).as_deref(),
        Ok("listTasks")
    );
    assert_eq!(
        operation_id(&segments, OperationIdCase::Snake).as_deref(),
        Ok("list_tasks")
    );
    assert_eq!(
        operation_id(&words(&["tasks", "list"]), OperationIdCase::Camel).as_deref(),
        Ok("tasksList")
    );
}

#[test]
fn case_mapping_of_non_ascii_letters_matches_ecmascript() {
    // `"İ".toLowerCase()` is "i" plus a combining dot, never the keyword `if`.
    assert_eq!(is_reserved("İF", Language::Php, Role::Schema), Ok(false));
    assert_eq!(is_reserved("IF", Language::Php, Role::Schema), Ok(true));
}
