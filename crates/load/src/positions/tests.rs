use std::collections::BTreeSet;

use indexmap::IndexSet;
use seampact_authoring::{AUTHORING_SCHEMA_FILES, LayerSchemaKind};
use seampact_json::JsonValue;
use serde_json::{Value, json};

use super::condition::{Container, holds};
use super::leaves::leaves;
use super::schema_files::SchemaFiles;
use super::schema_node::{SchemaNode, SchemaValue};
use super::types::{TypeSet, intersect};
use super::*;

fn schema(value: &Value) -> JsonValue {
    JsonValue::try_from(value.clone()).expect("a finite schema")
}

/// The position of `key` below the root of `schema`, read as the document root.
fn key_of(schema_value: &Value, key: &str) -> Option<Position> {
    let mut positions = Positions::new().expect("the embedded schemas load");
    let root = positions
        .position_of(&schema(schema_value))
        .expect("the schema compiles");

    positions
        .step_position(root.as_ref(), key, StepKind::Key)
        .expect("the step succeeds")
}

fn type_names(position: Option<&Position>) -> Option<Vec<TypeName>> {
    position?
        .types()
        .map(|types| types.iter().copied().collect())
}

fn closed(properties: &Value) -> Value {
    json!({ "type": "object", "properties": properties, "additionalProperties": false })
}

/// `if`, `then` and `else` with only the branches given.
fn when(condition: &Value, then: Option<&Value>, otherwise: Option<&Value>) -> Value {
    let mut out = json!({ "if": condition });

    if let Some(branch) = then {
        out["then"] = branch.clone();
    }

    if let Some(branch) = otherwise {
        out["else"] = branch.clone();
    }

    out
}

mod alternatives {
    use super::*;

    #[test]
    fn a_key_one_alternative_types_and_another_leaves_free_is_unknown() {
        let value = json!({ "anyOf": [closed(&json!({ "x": { "type": "string" } })), { "type": "object" }] });

        assert_eq!(key_of(&value, "x"), None);
    }

    #[test]
    fn the_same_through_then_and_else_and_through_one_of() {
        let open = json!({ "type": "object", "additionalProperties": {} });
        let typed = closed(&json!({ "x": { "type": "string" } }));
        let through_then = when(&json!({ "required": ["y"] }), Some(&typed), None);
        let through_one_of = json!({ "oneOf": [typed, open] });

        assert_eq!(key_of(&through_then, "x"), None);
        assert_eq!(type_names(key_of(&through_one_of, "x").as_ref()), None);
    }

    #[test]
    fn closed_alternatives_type_a_key_by_their_union() {
        let value = json!({ "anyOf": [
            closed(&json!({ "x": { "type": "string" } })),
            closed(&json!({ "x": { "type": "integer" } })),
        ] });

        assert_eq!(
            type_names(key_of(&value, "x").as_ref()),
            Some(vec![TypeName::Integer, TypeName::String])
        );
    }

    #[test]
    fn an_alternative_that_cannot_hold_a_key_is_dropped() {
        let value = json!({ "anyOf": [
            { "type": "string" },
            closed(&json!({ "x": { "type": "integer" } })),
            closed(&json!({ "y": {} })),
        ] });

        assert_eq!(
            type_names(key_of(&value, "x").as_ref()),
            Some(vec![TypeName::Integer])
        );
    }

    #[test]
    fn an_if_on_the_value_type_is_chosen_when_a_key_is_read() {
        let value = when(
            &json!({ "type": "string" }),
            Some(&json!({ "type": "string" })),
            Some(&closed(&json!({ "x": { "type": "boolean" } }))),
        );

        assert_eq!(
            type_names(key_of(&value, "x").as_ref()),
            Some(vec![TypeName::Boolean])
        );
    }
}

mod constraints_that_hold_together {
    use super::*;

    #[test]
    fn a_rule_beside_the_properties_types_nothing_away() {
        let mut value = closed(&json!({ "x": { "type": "string" } }));

        value["allOf"] = json!([{ "required": ["x"] }]);

        assert_eq!(
            type_names(key_of(&value, "x").as_ref()),
            Some(vec![TypeName::String])
        );
    }

    #[test]
    fn a_key_a_conflict_marker_forbids_in_a_case_that_holds_is_impossible() {
        let mut value = closed(&json!({ "x": { "type": "string" } }));

        value["allOf"] = json!([{ "properties": { "x": { "title": "conflict", "not": {} } } }]);

        assert_eq!(key_of(&value, "x"), None);
    }
}

mod data_positions {
    use super::*;

    #[test]
    fn only_a_node_marked_data_is_a_data_position() {
        let marked = key_of(&closed(&json!({ "x": { "title": "data" } })), "x");
        let commented = key_of(
            &closed(&json!({ "x": { "$comment": "ADR 0002 section 12" } })),
            "x",
        );
        let empty = key_of(&closed(&json!({ "x": {} })), "x");

        assert_eq!(marked.map(|position| position.is_data()), Some(true));
        assert_eq!(commented.map(|position| position.is_data()), Some(false));
        assert_eq!(empty.map(|position| position.is_data()), Some(false));
    }

    #[test]
    fn joined_nodes_are_data_when_a_constraint_marks_it_or_every_alternative_does() {
        let data = json!({ "title": "data" });
        let by_constraint = json!({ "allOf": [{}, data] });
        let by_every_alternative = json!({ "anyOf": [data, data] });
        let by_one_alternative = json!({ "anyOf": [data, {}] });
        let is_data = |value: &Value| {
            key_of(&closed(&json!({ "x": value })), "x").is_some_and(|position| position.is_data())
        };

        assert!(is_data(&by_constraint));
        assert!(is_data(&by_every_alternative));
        assert!(!is_data(&by_one_alternative));
    }
}

mod keyword_accounting {
    use super::*;

    fn keywords_used_by_the_authoring_schemas() -> BTreeSet<String> {
        let files = SchemaFiles::load().expect("the embedded schemas load");
        let mut used = BTreeSet::new();

        for file in AUTHORING_SCHEMA_FILES {
            let root = files.document(file.kind).expect("every file has a root");

            root.visit_schemas(&mut |node| {
                used.extend(node.members().map(|(key, _)| key.clone()));
            });
        }

        used
    }

    // The reading is a bounded interpreter of the schemas: a keyword it neither models nor
    // ignores on purpose could change where a key leads or what a scalar must be, unseen.
    #[test]
    fn the_authoring_schemas_use_no_keyword_the_position_reading_does_not_account_for() {
        let known: BTreeSet<&str> = POSITION_KEYWORDS
            .iter()
            .chain(IGNORED_KEYWORDS)
            .copied()
            .collect();
        let unaccounted: Vec<String> = keywords_used_by_the_authoring_schemas()
            .into_iter()
            .filter(|keyword| !known.contains(keyword.as_str()))
            .collect();

        assert_eq!(unaccounted, Vec::<String>::new());
    }

    // The ignored list names only what the schemas use, so a new keyword is a decision made here.
    #[test]
    fn the_ignored_list_names_only_what_the_schemas_use() {
        let used = keywords_used_by_the_authoring_schemas();
        let unused: Vec<&str> = IGNORED_KEYWORDS
            .iter()
            .copied()
            .filter(|keyword| !used.contains(*keyword))
            .collect();

        assert_eq!(unused, Vec::<&str>::new());
    }
}

mod real_schemas {
    use super::*;

    fn at(kind: LayerSchemaKind, path: &[&str]) -> Option<Position> {
        Positions::new()
            .expect("the embedded schemas load")
            .position_at(kind, path)
            .expect("the walk succeeds")
    }

    #[test]
    fn a_scalar_key_is_typed_and_an_unknown_key_is_not() {
        let version = at(LayerSchemaKind::Api, &["api", "version"]).expect("a position");

        assert_eq!(
            expected_types(&version),
            Some(vec!["an integer", "a string"])
        );
        assert_eq!(at(LayerSchemaKind::Api, &["api", "zzz"]), None);
    }

    #[test]
    fn an_integer_position_reads_its_bounds() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let version = positions
            .position_at(LayerSchemaKind::Api, &["api", "version"])
            .expect("the walk succeeds")
            .expect("a position");

        assert!(positions.admits_integer(&version, 0.0));
        assert!(positions.admits_integer(&version, 65535.0));
        assert!(!positions.admits_integer(&version, -1.0));
    }

    #[test]
    fn a_mapping_at_a_catalogue_is_the_fragment_of_that_file() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let conventions = positions
            .position_at(LayerSchemaKind::Api, &["conventions"])
            .expect("the walk succeeds");
        let api_block = positions
            .position_at(LayerSchemaKind::Api, &["api"])
            .expect("the walk succeeds");
        let entry = positions.entry_root_position().expect("the entry root");

        assert_eq!(
            positions.position_fragment_kind(conventions.as_ref()),
            Some("conventions")
        );
        assert_eq!(positions.position_fragment_kind(api_block.as_ref()), None);
        assert_eq!(positions.position_fragment_kind(Some(&entry)), None);
    }

    #[test]
    fn a_key_path_steps_by_key_and_an_index_steps_by_index() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let packs = positions
            .position_at(LayerSchemaKind::Api, &["packs"])
            .expect("the walk succeeds")
            .expect("a list");
        let by_key = positions
            .step_position(Some(&packs), "0", StepKind::Key)
            .expect("the step succeeds");
        let by_index = positions
            .step_position(Some(&packs), "0", StepKind::Index)
            .expect("the step succeeds");

        assert_eq!(by_key, None);
        assert_eq!(type_names(by_index.as_ref()), Some(vec![TypeName::String]));
    }

    #[test]
    fn the_same_step_answers_the_same_position() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .root_position(LayerSchemaKind::Api)
            .expect("the root");
        let first = positions
            .step_position(Some(&root), "api", StepKind::Key)
            .expect("the step succeeds");
        let second = positions
            .step_position(Some(&root), "api", StepKind::Key)
            .expect("the step succeeds");
        let unmentioned_a = positions
            .step_position(first.as_ref(), "zzz", StepKind::Key)
            .expect("the step succeeds");

        assert_eq!(first, second);
        assert_eq!(unmentioned_a, None);
        assert_eq!(
            positions.root_position(LayerSchemaKind::Api).expect("root"),
            root
        );
    }
}

mod refinement {
    use super::*;

    struct Keys {
        scalars: Vec<(&'static str, ScalarRead<'static>)>,
        open: bool,
    }

    impl MapView for Keys {
        fn has(&self, key: &str) -> bool {
            self.scalars.iter().any(|(name, _)| *name == key)
        }

        fn scalar(&self, key: &str) -> ScalarRead<'_> {
            self.scalars
                .iter()
                .find(|(name, _)| *name == key)
                .map_or(ScalarRead::NotScalar, |(_, read)| *read)
        }

        fn open(&self) -> bool {
            self.open
        }
    }

    fn route_or_collection() -> Value {
        when(
            &json!({ "required": ["method"] }),
            Some(&json!({ "properties": { "x": { "type": "string" } } })),
            Some(&json!({ "properties": { "x": { "type": "integer" } } })),
        )
    }

    fn refined_x(view: &Keys) -> (Option<Position>, Option<Position>) {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .position_of(&schema(&route_or_collection()))
            .expect("the schema compiles");
        let refined = positions.refine_position(root.as_ref(), view);
        let again = positions.refine_position(root.as_ref(), view);

        assert_eq!(refined, again, "equal choices are one position");

        let step = positions
            .step_position(refined.as_ref(), "x", StepKind::Key)
            .expect("the step succeeds");

        (refined, step)
    }

    static GET: JsonValue = JsonValue::Null;

    #[test]
    fn the_keys_of_a_mapping_choose_the_branch() {
        let with_method = Keys {
            scalars: vec![("method", ScalarRead::Scalar(&GET))],
            open: false,
        };
        let without = Keys {
            scalars: vec![],
            open: false,
        };

        assert_eq!(
            type_names(refined_x(&with_method).1.as_ref()),
            Some(vec![TypeName::String])
        );
        assert_eq!(
            type_names(refined_x(&without).1.as_ref()),
            Some(vec![TypeName::Integer])
        );
    }

    #[test]
    fn a_key_an_include_may_still_bring_keeps_both_branches() {
        let open = Keys {
            scalars: vec![],
            open: true,
        };

        assert_eq!(
            type_names(refined_x(&open).1.as_ref()),
            Some(vec![TypeName::Integer, TypeName::String])
        );
    }

    #[test]
    fn positions_refined_for_different_choices_differ() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .position_of(&schema(&route_or_collection()))
            .expect("the schema compiles");
        let route = Keys {
            scalars: vec![("method", ScalarRead::Scalar(&GET))],
            open: false,
        };
        let collection = Keys {
            scalars: vec![],
            open: false,
        };
        let as_route = positions.refine_position(root.as_ref(), &route);
        let as_collection = positions.refine_position(root.as_ref(), &collection);

        assert_ne!(as_route, as_collection);
        assert_eq!(positions.refine_position(None, &route), None);
    }

    #[test]
    fn a_data_position_is_not_refined() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let data = positions
            .position_of(&schema(&json!({ "title": "data" })))
            .expect("the schema compiles")
            .expect("a position");
        let view = Keys {
            scalars: vec![],
            open: false,
        };

        assert_eq!(positions.refine_position(Some(&data), &view), Some(data));
    }

    fn condition(value: &Value) -> SchemaValue {
        SchemaValue::from_json("common", &schema(value))
    }

    #[test]
    fn a_condition_holds_by_the_forms_the_grammar_writes() {
        let present = Keys {
            scalars: vec![("kind", ScalarRead::NotScalar)],
            open: false,
        };
        let holds_for = |value: &Value, view: Option<&dyn MapView>| {
            holds(&condition(value), Container::Object, view)
        };

        assert_eq!(holds_for(&json!(true), None), Some(true));
        assert_eq!(holds_for(&json!(false), None), Some(false));
        assert_eq!(holds_for(&json!("x"), None), None);
        assert_eq!(holds_for(&json!({}), None), Some(true));
        assert_eq!(holds_for(&json!({ "title": "a" }), None), Some(true));
        assert_eq!(
            holds_for(&json!({ "type": ["array", "object"] }), None),
            Some(true)
        );
        assert_eq!(holds_for(&json!({ "type": "array" }), None), Some(false));
        assert_eq!(holds_for(&json!({ "required": ["kind"] }), None), None);
        assert_eq!(
            holds_for(&json!({ "required": ["kind"] }), Some(&present)),
            Some(true)
        );
        assert_eq!(
            holds_for(&json!({ "required": ["other"] }), Some(&present)),
            Some(false)
        );
        assert_eq!(
            holds_for(&json!({ "required": [] }), Some(&present)),
            Some(true)
        );
        assert_eq!(holds_for(&json!({ "anyOf": [] }), None), Some(false));
        assert_eq!(
            holds_for(&json!({ "anyOf": [false, {}] }), None),
            Some(true)
        );
        assert_eq!(holds_for(&json!({ "allOf": [true, "x"] }), None), None);
        assert_eq!(
            holds_for(&json!({ "not": { "type": "array" } }), None),
            Some(true)
        );
        assert_eq!(holds_for(&json!({ "not": "x" }), None), None);
        assert_eq!(holds_for(&json!({ "minLength": 1 }), None), None);
        assert_eq!(
            holds_for(
                &json!({ "properties": { "kind": { "const": "a" } } }),
                Some(&present)
            ),
            None
        );
    }
}

mod javascript_semantics {
    use super::*;

    #[test]
    fn expected_keys_sort_by_utf16_code_unit_not_by_code_point() {
        let astral = "\u{10000}x";
        let high_bmp = "\u{FFFF}x";
        let value = closed(
            &json!({ high_bmp: {}, "b": {}, astral: {}, "10": {}, "9": {}, "$include": {} }),
        );
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .position_of(&schema(&value))
            .expect("the schema compiles")
            .expect("a position");

        assert_eq!(
            positions.expected_keys(&root),
            ["10", "9", "b", astral, high_bmp]
        );
    }

    #[test]
    fn expected_types_are_sorted_by_type_name_not_by_their_words() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .position_of(&schema(
                &json!({ "type": ["string", "integer", "array", "null"] }),
            ))
            .expect("the schema compiles")
            .expect("a position");

        assert_eq!(
            expected_types(&root),
            Some(vec!["a list", "an integer", "null", "a string"])
        );
    }

    #[test]
    fn schema_members_keep_the_array_index_keys_first() {
        let node = SchemaNode::from_object(
            "common",
            match &schema(&json!({ "b": 1, "10": 2, "a": 3, "2": 4 })) {
                JsonValue::Object(object) => object,
                other => panic!("not an object: {other:?}"),
            },
        );
        let keys: Vec<&str> = node.members().map(|(key, _)| key.as_str()).collect();

        assert_eq!(keys, ["2", "10", "b", "a"]);
    }

    #[test]
    fn leaves_are_met_in_the_order_of_the_combinators() {
        let files = SchemaFiles::load().expect("the embedded schemas load");
        let root = node_of(&json!({
            "allOf": [{ "title": "all" }],
            "anyOf": [{ "title": "any" }],
            "oneOf": [{ "title": "one" }],
            "if": {},
            "then": { "title": "then" },
            "else": { "title": "else" },
        }));
        let mut out = IndexSet::new();

        leaves(&files, &root, &mut out, None);

        let titles: Vec<Option<&str>> =
            out.iter().map(|node| node.string_member("title")).collect();

        assert_eq!(
            titles,
            [
                None,
                Some("all"),
                Some("any"),
                Some("one"),
                Some("then"),
                Some("else")
            ]
        );
    }

    fn node_of(value: &Value) -> SchemaNode {
        match SchemaValue::from_json("common", &schema(value)) {
            SchemaValue::Object(node) => node,
            other => panic!("not an object: {other:?}"),
        }
    }

    #[test]
    fn a_pattern_property_is_read_in_unicode_mode_with_ecmascript_syntax() {
        let value = json!({ "patternProperties": {
            "^x-.$": { "type": "string" },
            "^(a)\\1$": { "type": "integer" },
            "b": { "type": "boolean" },
        } });
        let types_of_key = |key: &str| type_names(key_of(&value, key).as_ref());

        assert_eq!(types_of_key("x-\u{1F600}"), Some(vec![TypeName::String]));
        assert_eq!(types_of_key("x-cd"), None);
        assert_eq!(types_of_key("aa"), Some(vec![TypeName::Integer]));
        assert_eq!(types_of_key("ab"), Some(vec![TypeName::Boolean]));
        assert_eq!(types_of_key("abc"), Some(vec![TypeName::Boolean]));
        assert_eq!(types_of_key("c"), None);
    }

    #[test]
    fn a_pattern_that_does_not_compile_is_refused_when_the_schema_is_read() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let broken = positions.position_of(&schema(&json!({ "patternProperties": { "[": {} } })));

        assert!(broken.is_err());
    }

    #[test]
    fn a_property_named_like_the_keyword_holds_no_pattern() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let value = json!({ "properties": { "patternProperties": { "[": {} } } });

        assert!(positions.position_of(&schema(&value)).is_ok());
    }

    #[test]
    fn a_missing_branch_or_list_form_leaves_the_child_free() {
        let empty_then = json!({ "if": { "required": ["y"] }, "then": [], "else": [] });
        let tuple_items = json!({ "type": "array", "items": [{ "type": "string" }] });
        let mut positions = Positions::new().expect("the embedded schemas load");
        let root = positions
            .position_of(&schema(&tuple_items))
            .expect("the schema compiles");

        assert_eq!(key_of(&empty_then, "x"), None);
        assert_eq!(
            positions
                .step_position(root.as_ref(), "0", StepKind::Index)
                .expect("the step succeeds"),
            None
        );
    }

    #[test]
    fn a_reference_that_names_no_node_adds_no_constraint() {
        let files = SchemaFiles::load().expect("the embedded schemas load");
        assert!(
            files
                .resolve_reference("other.schema.json#/$defs/x", "common")
                .is_none()
        );
        assert!(
            files
                .resolve_reference("common.schema.json#/$defs/missing", "common")
                .is_none()
        );
        assert!(
            files
                .resolve_reference("common.schema.json#/allOf/0", "common")
                .is_none()
        );
        assert!(
            files
                .resolve_reference("#/$defs/missing", "common")
                .is_none()
        );
        assert!(
            files
                .resolve_reference("common.schema.json", "node")
                .is_some()
        );
    }
}

mod types {
    use super::*;

    #[expect(
        clippy::unnecessary_wraps,
        reason = "the tests compare it with the Option the functions return"
    )]
    fn set(names: &[TypeName]) -> Option<TypeSet> {
        Some(names.iter().copied().collect())
    }

    #[test]
    fn a_constraint_that_states_no_type_adds_nothing() {
        assert_eq!(
            intersect(None, set(&[TypeName::String])),
            set(&[TypeName::String])
        );
        assert_eq!(
            intersect(set(&[TypeName::String]), None),
            set(&[TypeName::String])
        );
        assert_eq!(intersect(None, None), None);
    }

    #[test]
    fn an_integer_is_a_number_and_contradictions_leave_no_reading() {
        assert_eq!(
            intersect(set(&[TypeName::Integer]), set(&[TypeName::Number])),
            set(&[TypeName::Integer])
        );
        assert_eq!(
            intersect(set(&[TypeName::Number]), set(&[TypeName::Integer])),
            set(&[TypeName::Integer])
        );
        assert_eq!(
            intersect(set(&[TypeName::String]), set(&[TypeName::Null])),
            None
        );
        assert_eq!(intersect(set(&[]), set(&[TypeName::Null])), None);
    }

    #[test]
    fn an_empty_type_list_states_an_empty_reading_that_refuses_nothing() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let position = positions
            .position_of(&schema(&json!({ "type": [] })))
            .expect("the schema compiles");

        assert_eq!(
            position.as_ref().and_then(Position::types),
            Some(&TypeSet::new())
        );
        assert!(!refuses_scalar(position.as_ref(), ScalarType::String));
    }

    #[test]
    fn enum_and_const_state_the_types_of_their_values() {
        let by_enum = json!({ "enum": ["a", 1, null] });
        let by_const = json!({ "const": 1.5 });
        let wide_enum = json!({ "type": "number", "enum": [1, 2.5] });
        let of = |value: &Value| {
            let mut positions = Positions::new().expect("the embedded schemas load");

            positions
                .position_of(&schema(value))
                .expect("the schema compiles")
                .and_then(|position| position.types().cloned())
        };

        assert_eq!(
            of(&by_enum),
            set(&[TypeName::Integer, TypeName::Null, TypeName::String])
        );
        assert_eq!(of(&by_const), set(&[TypeName::Number]));
        assert_eq!(of(&wide_enum), set(&[TypeName::Integer, TypeName::Number]));
    }

    #[test]
    fn a_scalar_is_refused_by_a_position_that_does_not_take_its_type() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let mut position_of = |value: &Value| {
            positions
                .position_of(&schema(value))
                .expect("the schema compiles")
        };
        let number = position_of(&json!({ "type": "number" }));
        let integer = position_of(&json!({ "type": "integer" }));

        assert!(!refuses_scalar(number.as_ref(), ScalarType::Integer));
        assert!(refuses_scalar(integer.as_ref(), ScalarType::Number));
        assert!(refuses_scalar(integer.as_ref(), ScalarType::String));
        assert!(!refuses_scalar(None, ScalarType::String));
    }

    #[test]
    fn a_resolved_scalar_has_the_type_number_is_integer_gives() {
        let of = |text: &str| {
            scalar_type(
                &JsonValue::try_from(serde_json::from_str::<Value>(text).expect("JSON"))
                    .expect("finite"),
            )
        };

        assert_eq!(of("4.04e2"), Some(ScalarType::Integer));
        assert_eq!(of("-0"), Some(ScalarType::Integer));
        assert_eq!(of("1e21"), Some(ScalarType::Integer));
        assert_eq!(of("1e-17"), Some(ScalarType::Number));
        assert_eq!(of("1.5"), Some(ScalarType::Number));
        assert_eq!(of("\"a\""), Some(ScalarType::String));
        assert_eq!(of("null"), Some(ScalarType::Null));
        assert_eq!(of("true"), Some(ScalarType::Boolean));
        assert_eq!(of("[]"), None);
        assert_eq!(of("{}"), None);
    }

    #[test]
    fn integer_bounds_are_read_from_the_nodes_that_type_an_integer() {
        let mut positions = Positions::new().expect("the embedded schemas load");
        let bounded = positions
            .position_of(&schema(&json!({ "anyOf": [
                { "type": "integer", "minimum": 1, "maximum": 10 },
                { "type": ["string", "integer"], "exclusiveMinimum": 100, "exclusiveMaximum": 200 },
            ] })))
            .expect("the schema compiles")
            .expect("a position");
        let unbounded = positions
            .position_of(&schema(&json!({ "type": "string", "minimum": 5 })))
            .expect("the schema compiles")
            .expect("a position");

        assert!(positions.admits_integer(&bounded, 1.0));
        assert!(positions.admits_integer(&bounded, 10.0));
        assert!(!positions.admits_integer(&bounded, 11.0));
        assert!(!positions.admits_integer(&bounded, 100.0));
        assert!(positions.admits_integer(&bounded, 150.0));
        assert!(!positions.admits_integer(&bounded, 200.0));
        assert!(positions.admits_integer(&unbounded, -7.0));
    }
}
