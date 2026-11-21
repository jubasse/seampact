//! Unit tests of the ported bricks the fixtures do not pin: JavaScript key order, pointer
//! escaping, the reporter over a fake context, and the text the pattern and extension key
//! functions read by code point.

use std::thread;
use std::time::{Duration, Instant};

use indexmap::IndexMap;
use num_bigint::BigInt;
use seampact_ir::{Direction, ExtensionKey, ExtensionPrefix, Schema, TypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::testing::{HalfFixture, raw_api_from_json};

use crate::compile::TreeSchemasCompiler;
use crate::decimal::{TreeSchemasDecimal, TreeSchemasDecimalSource, tree_schemas_decimal_of};
use crate::directions::{DirectionHolder, directions_at, tree_schemas_write_directions, within};
use crate::enums::tree_schemas_compile_enums;
use crate::example_check::TreeSchemasExampleChecker;
use crate::extensions::{tree_schemas_extension_slot, tree_schemas_has_extensions};
use crate::pattern::{
    TreeSchemasPatternResult, tree_schemas_escape_pattern_literal, tree_schemas_normalize_pattern,
};
use crate::raw::{
    TreeSchemasProblem, TreeSchemasReporter, tree_schemas_entries, tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

fn parsed(text: &str) -> JsonValue {
    let raw = raw_api_from_json(text).expect("test json");

    JsonValue::Object(raw.merged)
}

#[test]
fn entries_list_array_index_keys_first_then_written_order() {
    let value = parsed(r#"{"b":1,"10":2,"a":3,"9":4}"#);
    let keys: Vec<&str> = tree_schemas_entries(Some(&value))
        .into_iter()
        .map(|(key, _)| key)
        .collect();

    assert_eq!(keys, ["9", "10", "b", "a"]);
    assert_eq!(tree_schemas_entries(Some(&JsonValue::Null)).len(), 0);
    assert_eq!(tree_schemas_entries(None).len(), 0);
}

#[test]
fn a_pointer_escapes_tilde_before_slash_and_keeps_astral_text() {
    assert_eq!(
        tree_schemas_pointer("/schemas", &["a/b", "~1", "\u{1F600}"]),
        "/schemas/a~1b/~01/\u{1F600}"
    );
    assert_eq!(tree_schemas_pointer("/x", &[]), "/x");
    assert_eq!(tree_schemas_pointer("", &[""]), "/");
}

#[test]
fn a_literal_pattern_escapes_each_metacharacter_by_code_point() {
    assert_eq!(
        tree_schemas_escape_pattern_literal("a.b*(c)/\\\u{1F600}"),
        "a\\.b\\*\\(c\\)\\/\\\\\u{1F600}"
    );
    assert_eq!(tree_schemas_escape_pattern_literal(""), "");
}

#[test]
fn the_reporter_locates_a_problem_and_its_related_pointer() {
    let mut fixture = HalfFixture::from_json(r#"{"a":{"x":1},"b":2}"#).expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let mut reporter = TreeSchemasReporter::new(context);

            assert!(reporter.resolves("/a/x"));
            assert!(!reporter.resolves("/nope"));

            reporter
                .error(TreeSchemasProblem {
                    rule: TreeSchemasRule::NameCollision,
                    pointer: "/a/x".to_owned(),
                    message: "message".to_owned(),
                    fix: "fix".to_owned(),
                    related: Some(vec![crate::raw::TreeSchemasRelated {
                        pointer: "/b".to_owned(),
                        message: "other".to_owned(),
                    }]),
                })
                .expect("located");

            reporter.into_reported()
        })
        .expect("context");
    let [diagnostic] = reported.as_slice() else {
        panic!("one diagnostic expected, got {reported:?}");
    };

    assert_eq!(diagnostic.rule.as_str(), "seampact/tree/name-collision");
    assert_eq!(diagnostic.origin.pointer, "/a/x");
    assert_eq!(
        diagnostic
            .related
            .first()
            .map(|other| other.origin.pointer.as_str()),
        Some("/b")
    );
}

#[test]
fn a_pointer_naming_no_node_is_an_internal_error_and_reports_nothing() {
    let mut fixture = HalfFixture::from_json(r#"{"a":1}"#).expect("fixture");
    let failed = fixture
        .with_context(|context| {
            let mut reporter = TreeSchemasReporter::new(context);
            let result = reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::NameCollision,
                pointer: "/missing".to_owned(),
                message: String::new(),
                fix: String::new(),
                related: None,
            });

            (result.is_err(), reporter.into_reported().len())
        })
        .expect("context");

    assert_eq!(failed, (true, 0));
}

#[test]
fn an_extension_slot_groups_keys_by_prefix_and_keeps_a_proto_key_as_data() {
    let value = parsed(r#"{"x-acme-a":1,"x-other-__proto__":2,"x-acme-b":3,"plain":4}"#);
    let JsonValue::Object(object) = &value else {
        panic!("an object expected");
    };
    let slot = tree_schemas_extension_slot(object);
    let acme = slot
        .get(&ExtensionPrefix::new("acme".to_owned()))
        .expect("acme prefix");
    let other = slot
        .get(&ExtensionPrefix::new("other".to_owned()))
        .expect("other prefix");

    assert_eq!(slot.len(), 2);
    assert_eq!(acme.len(), 2);
    assert!(other.contains_key(&ExtensionKey::new("__proto__".to_owned())));
    assert!(tree_schemas_has_extensions(object));
    assert!(!tree_schemas_has_extensions(&JsonObject::new()));
}

#[test]
fn schema_problems_follow_the_javascript_key_order_of_the_mapping() {
    let mut fixture = HalfFixture::from_json(
        r#"{"schemas":{"Thing":{"type":"object","zeta":1,"10":2,"2":3,"codeName":"x"}}}"#,
    )
    .expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                .expect("compiler");

            compiler.compile_catalogue().expect("catalogue");
            compiler.reporter.into_reported()
        })
        .expect("context");
    let pointers: Vec<&str> = reported
        .iter()
        .map(|diagnostic| diagnostic.origin.pointer.as_str())
        .collect();

    assert_eq!(
        pointers,
        [
            "/schemas/Thing/2",
            "/schemas/Thing/10",
            "/schemas/Thing/zeta"
        ]
    );
}

#[test]
fn a_mark_on_a_declared_object_is_refused_in_written_order() {
    let mut fixture = HalfFixture::from_json(
        r#"{"schemas":{"Thing":{"type":"object","properties":{},"default":{},"codeName":"x"}}}"#,
    )
    .expect("fixture");
    let reported = fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                .expect("compiler");

            compiler.compile_catalogue().expect("catalogue");
            compiler.reporter.into_reported()
        })
        .expect("context");
    let messages: Vec<&str> = reported
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();

    assert_eq!(
        messages,
        [
            "'codeName' sits on a property",
            "'default' sits on an optional property or an optional query field"
        ]
    );
}

/// What compiling the catalogue of `text` gave: the schemas, the uses at each declaration and the
/// reported messages.
fn compiled_catalogue(
    text: &str,
) -> (
    IndexMap<String, Schema>,
    IndexMap<String, TypeUse>,
    Vec<String>,
) {
    let mut fixture = HalfFixture::from_json(text).expect("fixture");

    fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut compiler = TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                .expect("compiler");

            compiler.compile_catalogue().expect("catalogue");

            let messages = compiler
                .reporter
                .into_reported()
                .into_iter()
                .map(|diagnostic| diagnostic.message)
                .collect();

            (compiler.schemas, compiler.uses, messages)
        })
        .expect("context")
}

#[test]
fn union_variants_sort_by_utf16_code_units_not_code_points() {
    let (schemas, _, messages) = compiled_catalogue(
        r#"{"schemas":{
            "A":{"type":"object","properties":{"a":{"type":"string"}}},
            "B":{"type":"object","properties":{"b":{"type":"string"}}},
            "U":{"oneOf":{"～":"A","😀":"B"},"discriminator":"kind"}
        }}"#,
    );
    let Some(Schema::Union(union)) = schemas.get("U") else {
        panic!("the union U expected, reported {messages:?}");
    };
    let tags: Vec<&str> = union
        .variants
        .iter()
        .map(|variant| variant.tag.as_str())
        .collect();

    assert_eq!(tags, ["\u{1F600}", "\u{FF5E}"]);
}

#[test]
fn an_array_range_message_prints_numbers_as_javascript_does() {
    let (_, _, messages) = compiled_catalogue(
        r#"{"schemas":{"L":{"type":"array","items":{"type":"string"},"minItems":1e21,"maxItems":2}}}"#,
    );

    assert_eq!(
        messages,
        ["no value fits the schema: 'minItems' 1e+21 is above 'maxItems' 2"]
    );
}

#[test]
fn an_example_string_is_measured_in_code_points() {
    let (schemas, uses, messages) = compiled_catalogue(
        r#"{"schemas":{
            "Long":{"type":"string","minLength":2}
        }}"#,
    );
    let no_enums = IndexMap::new();
    let checker = TreeSchemasExampleChecker::new(&schemas, &no_enums);
    let emoji = JsonValue::String("\u{1F600}".to_owned());
    let long = uses.get("/schemas/Long").expect("Long use");
    let shorter = checker.check(&emoji, long).expect("check");

    assert_eq!(messages, Vec::<String>::new());
    assert_eq!(
        shorter
            .iter()
            .map(|issue| issue.message.as_str())
            .collect::<Vec<_>>(),
        ["'\u{1F600}' is shorter than 2 characters"]
    );
}

#[test]
fn the_nearest_direction_holder_is_the_longest_in_utf16_units_and_the_first_on_a_tie() {
    let holders = [
        DirectionHolder::new("/a", &[Direction::Input]),
        DirectionHolder::new("/a/\u{1F600}", &[Direction::Output]),
        DirectionHolder::new("/a/\u{1F600}", &[Direction::Input]),
    ];

    assert_eq!(
        directions_at(&holders, "/a/\u{1F600}/x"),
        [Direction::Output]
    );
    assert_eq!(directions_at(&holders, "/a/b"), [Direction::Input]);
    assert_eq!(directions_at(&holders, "/ab"), []);
    assert!(within("/a", "/a"));
    assert!(!within("/ab", "/a"));
}

#[test]
fn a_decimal_reads_a_number_through_its_shortest_form() {
    let number = |value: f64| tree_schemas_decimal_of(TreeSchemasDecimalSource::Number(value));
    let text = |value: &str| tree_schemas_decimal_of(TreeSchemasDecimalSource::Text(value));

    assert_eq!(
        number(1e-7),
        Ok(Some(TreeSchemasDecimal {
            units: BigInt::from(1),
            scale: 7
        }))
    );
    assert_eq!(
        number(1e21),
        Ok(Some(TreeSchemasDecimal {
            units: BigInt::from(10).pow(21),
            scale: 0
        }))
    );
    assert_eq!(
        text("-12.50"),
        Ok(Some(TreeSchemasDecimal {
            units: BigInt::from(-1250),
            scale: 2
        }))
    );
    assert_eq!(
        text("1e-2"),
        Ok(Some(TreeSchemasDecimal {
            units: BigInt::from(1),
            scale: 2
        }))
    );

    for refused in ["", "+1", ".5", "1.", "1e", "0x10", "1 ", "\u{ff11}"] {
        assert_eq!(text(refused), Ok(None), "text {refused:?}");
    }
}

#[test]
fn a_pattern_is_normalised_by_code_point_and_refused_with_its_fix() {
    let normalized = |source: &str| tree_schemas_normalize_pattern(source);

    assert_eq!(
        normalized("a|b"),
        Ok(TreeSchemasPatternResult::Normalized {
            normalized: "a|b".to_owned()
        })
    );
    let Ok(TreeSchemasPatternResult::Refused { message, .. }) = normalized("*") else {
        panic!("a lone star is refused");
    };

    assert_eq!(
        message,
        "the pattern is not portable: '*' has nothing to repeat"
    );
}

const CHAIN_LINKS: usize = 100_000;
const SMALL_STACK_BYTES: usize = 2 * 1024 * 1024;
const CHAIN_BUDGET: Duration = Duration::from_secs(5);
/// A compile of 100,000 links takes about a second alone and several under a loaded run; a walk
/// that repeats per link takes far longer.
const COMPILE_CHAIN_BUDGET: Duration = Duration::from_secs(30);

/// Runs `work` on a thread with a 2 MiB stack, as a host thread may have, and returns its answer.
fn on_small_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    thread::Builder::new()
        .stack_size(SMALL_STACK_BYTES)
        .spawn(work)
        .expect("thread")
        .join()
        .expect("the walk ended without overflowing the stack")
}

#[test]
fn a_long_alias_chain_reaches_its_object_without_overflowing_the_stack() {
    let (schemas, messages, elapsed) = on_small_stack(|| {
        let aliases: Vec<String> = (0..CHAIN_LINKS)
            .map(|index| format!(r#""A{index}":"A{}""#, index + 1))
            .collect();
        let text = format!(
            r#"{{"schemas":{{"A{CHAIN_LINKS}":{{"type":"object","properties":{{"last":{{"type":"string"}}}}}},{},"Holder":{{"type":"object","properties":{{"first":"A0"}}}}}}}}"#,
            aliases.join(",")
        );
        let started = Instant::now();
        let (schemas, _, messages) = compiled_catalogue(&text);

        (schemas, messages, started.elapsed())
    });

    assert_eq!(messages, Vec::<String>::new());
    assert!(schemas.contains_key("Holder"));
    assert!(
        elapsed < COMPILE_CHAIN_BUDGET,
        "alias chain took {elapsed:?}"
    );
}

#[test]
fn a_long_object_chain_gives_its_directions_to_every_link() {
    let (last_directions, elapsed) = on_small_stack(|| {
        let links: Vec<String> = (0..CHAIN_LINKS)
            .map(|index| {
                format!(
                    r#""N{index}":{{"type":"object","properties":{{"next":"N{}"}}}}"#,
                    index + 1
                )
            })
            .collect();
        let text = format!(
            r#"{{"schemas":{{{},"N{CHAIN_LINKS}":{{"type":"object","properties":{{"last":{{"type":"string"}}}}}}}}}}"#,
            links.join(",")
        );
        let mut fixture = HalfFixture::from_json(&text).expect("fixture");
        fixture
            .with_context(|context| {
                let merged = &context.raw.merged;
                let mut compiler =
                    TreeSchemasCompiler::new(merged, TreeSchemasReporter::new(context))
                        .expect("compiler");

                compiler.compile_catalogue().expect("catalogue");
                compiler
                    .position_directions
                    .insert("/schemas/N0".to_owned(), vec![Direction::Input]);

                let started = Instant::now();

                tree_schemas_write_directions(&mut compiler, &mut [], &mut [], &[])
                    .expect("directions");

                let directions = match compiler.schemas.get(&format!("N{CHAIN_LINKS}")) {
                    Some(Schema::Object(object)) => object.directions.clone(),
                    other => panic!("the last link expected, got {other:?}"),
                };

                (directions, started.elapsed())
            })
            .expect("context")
    });

    assert_eq!(last_directions, [Direction::Input]);
    assert!(
        elapsed < CHAIN_BUDGET,
        "the directions walk took {elapsed:?}"
    );
}

#[test]
fn a_long_source_enum_chain_is_followed_once_not_once_per_link() {
    const LINKS: usize = 1_000;

    let links: Vec<String> = (1..LINKS)
        .map(|index| format!(r#""E{index}":{{"source":{{"enum":"E{}"}}}}"#, index - 1))
        .collect();
    let text = format!(
        r#"{{"enums":{{"E0":{{"values":["a","b"],"codeNames":{{"a":"Alpha"}},"reason":"local"}},{}}}}}"#,
        links.join(",")
    );
    let mut fixture = HalfFixture::from_json(&text).expect("fixture");
    let (compiled, messages, elapsed) = fixture
        .with_context(|context| {
            let merged = &context.raw.merged;
            let mut reporter = TreeSchemasReporter::new(context);
            let started = Instant::now();
            let compiled = tree_schemas_compile_enums(merged.get("enums"), &mut reporter);

            (compiled, reporter.into_reported(), started.elapsed())
        })
        .expect("context");
    let compiled = compiled.expect("enums");
    let last = compiled.last().expect("the last link");

    assert_eq!(messages.len(), 0);
    assert_eq!(compiled.len(), LINKS);
    assert_eq!(last.values, ["a", "b"]);
    assert!(
        last.code_names
            .as_ref()
            .is_some_and(|names| names.get("a").is_some())
    );
    assert!(elapsed < CHAIN_BUDGET, "enum chain took {elapsed:?}");
}
