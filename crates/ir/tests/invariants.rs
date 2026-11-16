//! The invariants of the IR on the every-member example, broken one rule at a time.

#![expect(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test helpers: a sample that lacks what a test breaks fails the test"
)]

use seampact_ir::{IrInvariantId, check_ir_invariants};
use seampact_json::JsonValue;
use serde_json::{Map, Value, json};

const EVERY_MEMBER_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/every-member.ir.json");
const MINIMAL_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/minimal.ir.json");

type Found = Vec<(IrInvariantId, String)>;

fn sample() -> Value {
    serde_json::from_str(EVERY_MEMBER_EXAMPLE).expect("the every-member example is JSON")
}

fn found(ir: &Value) -> Found {
    let ir = JsonValue::try_from(ir.clone()).expect("the document holds finite numbers");

    check_ir_invariants(&ir)
        .expect("the document decodes")
        .into_iter()
        .map(|violation| (violation.id, violation.pointer))
        .collect()
}

// The violations of the every-member example after `change`.
fn after(change: impl FnOnce(&mut Value)) -> Found {
    let mut ir = sample();

    change(&mut ir);

    found(&ir)
}

fn at(id: IrInvariantId, pointer: &str) -> Found {
    vec![(id, pointer.to_owned())]
}

fn ids(found: &Found) -> Vec<IrInvariantId> {
    found.iter().map(|(id, _)| *id).collect()
}

fn of(found: Found, id: IrInvariantId) -> Found {
    found
        .into_iter()
        .filter(|(found, _)| *found == id)
        .collect()
}

fn node<'ir>(ir: &'ir mut Value, pointer: &str) -> &'ir mut Map<String, Value> {
    ir.pointer_mut(pointer)
        .and_then(Value::as_object_mut)
        .unwrap_or_else(|| panic!("no object at {pointer}"))
}

fn list<'ir>(ir: &'ir mut Value, pointer: &str) -> &'ir mut Vec<Value> {
    ir.pointer_mut(pointer)
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("no array at {pointer}"))
}

fn set(ir: &mut Value, pointer: &str, member: &str, value: Value) {
    node(ir, pointer).insert(member.to_owned(), value);
}

fn remove(ir: &mut Value, pointer: &str, member: &str) {
    node(ir, pointer).remove(member);
}

fn copy_of(ir: &Value, pointer: &str) -> Value {
    ir.pointer(pointer)
        .unwrap_or_else(|| panic!("nothing at {pointer}"))
        .clone()
}

const UPDATE: &str = "/operations/2";
const ALWAYS_ABSENT: &str = "/operations/2/fieldRights/2";
const EFFORT_OUTPUT: &str = "/operations/2/fieldRights/1";
const CREATED_KEY: &str = "/operations/2/paging/sortKeys/0";
const EFFORT_KEY: &str = "/operations/2/paging/sortKeys/1";
const EFFORT: &str = "/schemas/Task/properties/1";
const RETRY_AFTER: &str = "/schemas/ThrottledParams/properties/0";
const LOCKED: &str = "/operations/2/errors/0";
const THROTTLED: &str = "/operations/2/errors/1";
const INTERNAL: &str = "/operations/2/errors/2";
const DEPRECATED: &str = "/operations/2/deprecated";
const INPUT: &str = "/operations/2/input";

#[test]
fn accepts_the_valid_samples() {
    assert_eq!(found(&sample()), Found::new());
    assert_eq!(
        found(&serde_json::from_str(MINIMAL_EXAMPLE).expect("the minimal example is JSON")),
        Found::new()
    );
    assert_eq!(found(&Value::Null), Found::new());
}

// Each case breaks the rule at `pointer` of the example and expects exactly that rule.
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one table of the rules and their breaks"
)]
fn names_each_broken_rule_with_its_id() {
    type Change = fn(&mut Value);

    let cases: [(&str, IrInvariantId, Change); 21] = [
        ("/schemas/Task/name", IrInvariantId::NameStatus, |ir| {
            set(ir, "/schemas/Task/name", "status", json!(201));
        }),
        (
            "/schemas/CreateTaskResponse201/name",
            IrInvariantId::NameStatus,
            |ir| remove(ir, "/schemas/CreateTaskResponse201/name", "status"),
        ),
        (
            "/formats/bare/meta/tenant",
            IrInvariantId::MetaSource,
            |ir| {
                remove(ir, "/formats/bare/meta/tenant", "source");
            },
        ),
        (
            "/formats/bare/meta/tenant/source",
            IrInvariantId::ValueSourceMembers,
            |ir| remove(ir, "/formats/bare/meta/tenant/source", "name"),
        ),
        (
            "/formats/bare/meta/tenant/source",
            IrInvariantId::ValueSourceMembers,
            |ir| {
                set(
                    ir,
                    "/formats/bare/meta/tenant/source",
                    "prefixBits",
                    json!(8),
                );
            },
        ),
        (
            "/formats/bare/meta/tenant/source",
            IrInvariantId::ValueSourcePlace,
            |ir| {
                let source = "/formats/bare/meta/tenant/source";

                set(ir, source, "in", json!("resolver"));
                remove(ir, source, "name");
            },
        ),
        ("/headers/version", IrInvariantId::HeaderMembers, |ir| {
            set(ir, "/headers/version", "name", json!("X-Version"));
        }),
        ("/headers/deadline", IrInvariantId::HeaderMembers, |ir| {
            remove(ir, "/headers/deadline", "in");
        }),
        (
            "/operations/2/cache",
            IrInvariantId::CacheDirectives,
            |ir| {
                remove(ir, "/operations/2/cache", "directives");
            },
        ),
        (
            "/operations/0/cache",
            IrInvariantId::CacheDirectives,
            |ir| {
                set(ir, "/operations/0/cache", "noStore", json!(false));
            },
        ),
        (UPDATE, IrInvariantId::CsrfCookie, |ir| {
            remove(ir, UPDATE, "csrf");
        }),
        (
            "/operations/2/input/fields/1/wire",
            IrInvariantId::FieldWireMembers,
            |ir| {
                let wire = "/operations/2/input/fields/1/wire";

                set(ir, wire, "kind", json!("file"));
                set(ir, wire, "style", json!("form"));
            },
        ),
        (
            "/schemas/Task/properties/0",
            IrInvariantId::PropertyNullable,
            |ir| {
                set(
                    ir,
                    "/schemas/Task/properties/0/type",
                    "nullable",
                    json!(true),
                );
            },
        ),
        (
            "/schemas/Task/properties/0",
            IrInvariantId::PropertySensitive,
            |ir| {
                set(
                    ir,
                    "/schemas/Task/properties/0/type",
                    "sensitive",
                    json!(true),
                );
            },
        ),
        ("/scalars/money", IrInvariantId::ScalarType, |ir| {
            set(ir, "/scalars/money/type", "scalar", json!("money"));
        }),
        ("/scopes/workspace", IrInvariantId::IdScalar, |ir| {
            set(ir, "/scopes/workspace/idSchema", "nullable", json!(true));
        }),
        (
            "/rights/tasks.update/subject",
            IrInvariantId::IdScalar,
            |ir| {
                set(
                    ir,
                    "/rights/tasks.update/subject",
                    "idSchema",
                    json!({"kind": "ref", "schema": "Task"}),
                );
            },
        ),
        ("/rules/quota/proof", IrInvariantId::IdScalar, |ir| {
            set(
                ir,
                "/rules/quota/proof",
                "schema",
                json!({"kind": "opaque"}),
            );
        }),
        ("/rules/quota/proof", IrInvariantId::IdScalar, |ir| {
            set(ir, "/rules/quota/proof", "schema", json!({"kind": "file"}));
        }),
        (
            "/operations/2/input/proofs/0",
            IrInvariantId::IdScalar,
            |ir| {
                set(
                    ir,
                    "/operations/2/input/proofs/0",
                    "schema",
                    json!({"kind": "file", "media": ["image/png"]}),
                );
            },
        ),
        (
            "/operations/2/input/proofs/0",
            IrInvariantId::IdScalar,
            |ir| {
                set(
                    ir,
                    "/operations/2/input/proofs/0",
                    "schema",
                    json!({"kind": "opaque"}),
                );
            },
        ),
    ];

    for (position, (pointer, id, change)) in cases.into_iter().enumerate() {
        let found = after(change);

        assert_eq!(
            ids(&found),
            vec![id],
            "case {position} at {pointer}: {found:?}"
        );
    }
}

#[test]
fn an_unknown_use_kind_is_the_readers_and_a_proof_may_be_an_enum_or_an_array() {
    assert_eq!(
        after(|ir| set(
            ir,
            "/scopes/workspace",
            "idSchema",
            json!({"kind": "zzLater"})
        )),
        Found::new()
    );
    assert_eq!(
        after(|ir| set(
            ir,
            "/rules/quota/proof",
            "schema",
            json!({"kind": "array", "items": {"kind": "scalar", "type": "string", "refinements": {}}}),
        )),
        Found::new()
    );
}

#[test]
fn leaves_unknown_values_to_the_reader() {
    let later = json!("zzLater");

    assert_eq!(
        after(|ir| set(ir, "/headers/version", "semantic", later.clone())),
        Found::new()
    );
    assert_eq!(
        after(|ir| set(ir, "/formats/bare/meta/tenant", "fill", later.clone())),
        Found::new()
    );
    assert_eq!(
        after(|ir| set(
            ir,
            "/schemas/CreateTaskResponse201/name",
            "role",
            later.clone()
        )),
        Found::new()
    );
    assert_eq!(
        after(|ir| set(ir, "/formats/bare/meta/tenant/source", "in", later.clone())),
        Found::new()
    );
}

#[test]
fn a_body_proofs_type_use_names_existing_entries() {
    assert_eq!(
        after(|ir| set(
            ir,
            "/operations/2/input/proofs/0/schema",
            "scalar",
            json!("missingId")
        )),
        at(
            IrInvariantId::RefResolves,
            "/operations/2/input/proofs/0/schema/scalar"
        )
    );
}

// The proof of the example's input, its input in a JSON body, or in a form body.
fn proof_input_after(change: impl FnOnce(&mut Value)) -> Found {
    after(change)
}

#[test]
fn a_body_proof_has_a_wire_form_exactly_when_its_input_is_form_or_multipart() {
    let proof = "/operations/2/input/proofs/0";
    let to_json = |ir: &mut Value| {
        set(ir, INPUT, "media", json!("application/json"));
        remove(ir, INPUT, "fields");
    };

    // The example's multipart input sends its proof as a text field.
    assert_eq!(proof_input_after(|_| {}), Found::new());
    assert_eq!(
        proof_input_after(|ir| remove(ir, proof, "wire")),
        at(IrInvariantId::InputProofWire, proof)
    );
    assert_eq!(
        proof_input_after(to_json),
        at(IrInvariantId::InputProofWire, proof)
    );
    assert_eq!(
        proof_input_after(|ir| {
            to_json(ir);
            remove(ir, proof, "wire");
        }),
        Found::new()
    );
    // An unknown media type is the reader's to name.
    assert_eq!(
        proof_input_after(|ir| set(ir, INPUT, "media", json!("application/zz-later"))),
        Found::new()
    );
    // The wire itself follows ir.field-wire.members.
    assert_eq!(
        proof_input_after(|ir| set(ir, proof, "wire", json!({"kind": "json", "style": "form"}))),
        at(
            IrInvariantId::FieldWireMembers,
            "/operations/2/input/proofs/0/wire"
        )
    );
    // A proof is never a file, so neither is its wire form.
    assert_eq!(
        proof_input_after(|ir| set(ir, proof, "wire", json!({"kind": "file"}))),
        at(IrInvariantId::InputProofWire, proof)
    );
}

#[test]
fn a_body_proof_is_identified_by_a_name_the_body_does_not_already_carry() {
    let proof = |position: usize| format!("{INPUT}/proofs/{position}");

    // `title` is a property of Task, the input schema.
    assert_eq!(
        after(|ir| set(ir, &proof(0), "name", json!("title"))),
        at(IrInvariantId::InputProofName, &proof(0))
    );
    // A form field named like the proof, and like no property.
    assert_eq!(
        after(|ir| {
            set(ir, &format!("{INPUT}/fields/0"), "name", json!("scan"));
            set(ir, &proof(0), "name", json!("scan"));
        }),
        at(IrInvariantId::InputProofName, &proof(0))
    );
    assert_eq!(
        after(|ir| {
            let first = copy_of(ir, &proof(0));

            list(ir, &format!("{INPUT}/proofs")).push(first);
        }),
        at(IrInvariantId::InputProofName, &proof(1))
    );
    // A name is free once the schema no longer holds it.
    assert_eq!(
        after(|ir| {
            set(
                ir,
                INPUT,
                "schema",
                json!({"kind": "ref", "schema": "LockedParams"}),
            );
            remove(ir, INPUT, "fields");
            set(ir, INPUT, "media", json!("application/json"));
            remove(ir, &proof(0), "wire");
        }),
        Found::new()
    );
}

// The example's input with proofs, as a JSON body.
fn json_input_after(change: impl FnOnce(&mut Value)) -> Found {
    after(|ir| {
        set(ir, INPUT, "media", json!("application/json"));
        remove(ir, INPUT, "fields");
        remove(ir, &format!("{INPUT}/proofs/0"), "wire");
        change(ir);
    })
}

#[test]
fn an_input_with_body_proofs_is_a_ref_use_of_an_object_schema() {
    let schema = format!("{INPUT}/schema");
    let use_of = |type_use: Value| move |ir: &mut Value| set(ir, INPUT, "schema", type_use);

    assert_eq!(
        json_input_after(use_of(json!({"kind": "ref", "schema": "Task"}))),
        Found::new()
    );

    // Labels is a map schema, Notice a union.
    for target in ["Labels", "Notice"] {
        assert_eq!(
            json_input_after(use_of(json!({"kind": "ref", "schema": target}))),
            at(IrInvariantId::InputProofInput, &schema),
            "{target}"
        );
    }

    assert_eq!(
        json_input_after(use_of(
            json!({"kind": "scalar", "type": "string", "refinements": {}})
        )),
        at(IrInvariantId::InputProofInput, &schema)
    );
    // Without proofs any input stands; an unknown use kind is the reader's to name.
    assert_eq!(
        json_input_after(|ir| {
            set(
                ir,
                INPUT,
                "schema",
                json!({"kind": "ref", "schema": "Labels"}),
            );
            remove(ir, INPUT, "proofs");
        }),
        Found::new()
    );
    assert_eq!(
        json_input_after(use_of(json!({"kind": "zz-later"}))),
        Found::new()
    );
    // A ref to a schema of an unknown kind is the reader's to name.
    assert_eq!(
        json_input_after(|ir| {
            set(ir, "/schemas/Labels", "kind", json!("zz-later"));
            set(
                ir,
                INPUT,
                "schema",
                json!({"kind": "ref", "schema": "Labels"}),
            );
        }),
        Found::new()
    );
    // A ref to a missing id breaks only ir.ref.resolves.
    assert_eq!(
        ids(&json_input_after(use_of(
            json!({"kind": "ref", "schema": "Missing"})
        ))),
        vec![IrInvariantId::RefResolves]
    );
}

#[test]
fn a_core_origin_points_at_its_declaration_under_its_catalogue() {
    let origin = "/errors/api.internal/origin";
    let violation = at(IrInvariantId::OriginCore, origin);
    let with_origin = |change: fn(&mut Map<String, Value>)| after(|ir| change(node(ir, origin)));

    assert_eq!(with_origin(|_| {}), Found::new());
    // Below the entry is fine; a relay route's copy names its api and is read there.
    assert_eq!(
        with_origin(|origin| {
            origin.insert("pointer".to_owned(), json!("/errors/api.internal/http"));
        }),
        Found::new()
    );
    assert_eq!(
        with_origin(|origin| {
            origin.insert("api".to_owned(), json!("billing"));
            origin.insert("pointer".to_owned(), json!("/errors/api.upstream_timeout"));
        }),
        Found::new()
    );

    for pointer in [
        "",
        "/errors",
        "/errors/",
        "/rights/tasks.read",
        "/surfaces/app",
        "/schemas/ApiSchemaInvalidIssue",
    ] {
        let found = after(|ir| set(ir, origin, "pointer", json!(pointer)));

        assert_eq!(found, violation, "pointer {pointer:?}");
    }

    // Other layers keep their pointers into the authoring tree.
    assert_eq!(
        with_origin(|origin| {
            origin.insert("layer".to_owned(), json!("api"));
            origin.insert("pointer".to_owned(), json!("/surfaces/app"));
        }),
        Found::new()
    );
}

#[test]
fn every_catalogue_id_names_an_existing_entry() {
    let found = after(|ir| {
        set(ir, "/schemes/sessionCookie", "csrf", json!("missing"));
        set(
            ir,
            "/identities/user",
            "principal",
            json!({"kind": "schema", "schema": "Missing"}),
        );
        set(
            ir,
            "/api/documents",
            "public",
            json!({"surfaces": ["nowhere"], "internal": "exclude"}),
        );
        // A key read exactly: an id spelled like a prototype member resolves to nothing.
        set(ir, "/rights/tasks.read", "id", json!("constructor"));
        set(
            ir,
            "/scopes/workspace/idSchema",
            "scalar",
            json!("missingId"),
        );
        set(
            ir,
            "/rights/tasks.update/subject",
            "idSchema",
            json!({"kind": "enum", "enum": "MissingId"}),
        );
    });
    let expected: Found = [
        "/api/documents/public/surfaces/0",
        "/schemes/sessionCookie/csrf",
        "/identities/user/principal/schema",
        "/rights/tasks.read/id",
        "/rights/tasks.update/subject/idSchema/enum",
        "/scopes/workspace/idSchema/scalar",
    ]
    .into_iter()
    .map(|pointer| (IrInvariantId::RefResolves, pointer.to_owned()))
    .collect();

    assert_eq!(found, expected);
}

const PATH_SUBJECT: fn() -> Value = || json!({"source": {"in": "path", "name": "taskId"}});

#[test]
fn a_field_right_always_absent_is_an_output_right_without_subject_policy_or_params() {
    let changes = [
        ("direction", json!("input")),
        ("subject", PATH_SUBJECT()),
        ("inputPolicy", json!("strip")),
        ("params", json!({})),
    ];

    for (member, value) in changes {
        let found = of(
            after(|ir| set(ir, ALWAYS_ABSENT, member, value)),
            IrInvariantId::FieldRightAlways,
        );

        assert_eq!(
            found,
            at(IrInvariantId::FieldRightAlways, ALWAYS_ABSENT),
            "{member}"
        );
    }

    // An unknown outcome is the reader's to name.
    assert_eq!(
        after(|ir| {
            set(ir, ALWAYS_ABSENT, "always", json!("masked"));
            set(ir, ALWAYS_ABSENT, "direction", json!("input"));
        }),
        Found::new()
    );
}

#[test]
fn a_field_right_has_a_subject_if_and_only_if_its_rights_subject_kind_is_not_none() {
    assert_eq!(
        after(|ir| remove(ir, EFFORT_OUTPUT, "subject")),
        at(IrInvariantId::FieldRightAlways, EFFORT_OUTPUT)
    );
    assert_eq!(
        after(|ir| {
            remove(ir, ALWAYS_ABSENT, "always");
            set(ir, ALWAYS_ABSENT, "subject", PATH_SUBJECT());
        }),
        at(IrInvariantId::FieldRightAlways, ALWAYS_ABSENT)
    );
}

#[test]
fn sort_key_params_and_subject_sit_with_a_right() {
    assert_eq!(
        after(|ir| remove(ir, EFFORT_KEY, "right")),
        at(IrInvariantId::SortKeyRight, EFFORT_KEY)
    );
}

#[test]
fn a_sort_key_has_a_subject_if_and_only_if_its_rights_subject_kind_is_not_none() {
    assert_eq!(
        after(|ir| remove(ir, EFFORT_KEY, "subject")),
        at(IrInvariantId::SortKeyRight, EFFORT_KEY)
    );
    assert_eq!(
        after(|ir| set(ir, CREATED_KEY, "subject", PATH_SUBJECT())),
        at(IrInvariantId::SortKeyRight, CREATED_KEY)
    );
}

#[test]
fn a_sort_key_subject_is_not_read_from_a_holder_field() {
    assert_eq!(
        after(|ir| set(
            ir,
            EFFORT_KEY,
            "subject",
            json!({"source": {"in": "holderField", "name": "ownerId"}}),
        )),
        at(
            IrInvariantId::SortKeyRight,
            &format!("{EFFORT_KEY}/subject/source")
        )
    );
}

fn exact(pointer: &str) -> (IrInvariantId, String) {
    (IrInvariantId::ValueExactNumber, pointer.to_owned())
}

#[test]
fn opaque_int64_and_decimal_values_are_strings() {
    assert_eq!(
        after(|ir| {
            set(ir, EFFORT, "default", json!(1));
            set(ir, EFFORT, "examples", json!(["2", 3]));
            set(ir, &format!("{EFFORT}/type"), "examples", json!([4]));
        }),
        vec![
            exact(&format!("{EFFORT}/default")),
            exact(&format!("{EFFORT}/examples/1")),
            exact(&format!("{EFFORT}/type/examples/0")),
        ]
    );
    assert_eq!(
        after(|ir| {
            set(
                ir,
                EFFORT,
                "type",
                json!({"kind": "scalar", "type": "string", "format": "decimal", "refinements": {}}),
            );
            set(ir, EFFORT, "default", json!("1.50"));
            set(ir, EFFORT, "examples", json!([1.5, "1."]));
        }),
        vec![
            exact(&format!("{EFFORT}/examples/0")),
            exact(&format!("{EFFORT}/examples/1")),
        ]
    );
}

#[test]
fn an_opaque_integer_past_the_safe_range_breaks_exact_number() {
    assert_eq!(
        after(|ir| {
            set(ir, RETRY_AFTER, "default", json!(9_007_199_254_740_992_u64));
            set(
                ir,
                RETRY_AFTER,
                "examples",
                json!([9_007_199_254_740_991_u64]),
            );
        }),
        vec![exact(&format!("{RETRY_AFTER}/default"))]
    );
    assert_eq!(
        after(|ir| {
            list(ir, "/operations/2/params/query").push(json!({
                "name": "limit",
                "type": {"kind": "scalar", "type": "integer", "refinements": {}},
                "required": false,
                "wire": {"kind": "number", "style": "form", "explode": true, "brackets": false},
                "default": 1.5,
                "origin": {"layer": "api", "pointer": "/query/limit"},
            }));
        }),
        vec![exact("/operations/2/params/query/1/default")]
    );
}

#[test]
fn an_int64_string_out_of_range_or_negative_zero_breaks_exact_number() {
    for value in ["-0", "9223372036854775808", "-9223372036854775809", "01"] {
        assert_eq!(
            after(|ir| set(ir, EFFORT, "default", json!(value))),
            vec![exact(&format!("{EFFORT}/default"))],
            "{value}"
        );
    }

    for value in [
        json!("9223372036854775807"),
        json!("-9223372036854775808"),
        json!("0"),
        Value::Null,
    ] {
        assert_eq!(
            after(|ir| set(ir, EFFORT, "default", value.clone())),
            Found::new(),
            "{value}"
        );
    }
}

#[test]
fn a_degradable_header_is_required_without_a_degraded_meta_field() {
    let degradable = format!("{UPDATE}/degradable");

    assert_eq!(
        after(|ir| remove(ir, &degradable, "header")),
        at(IrInvariantId::DegradableHeader, &degradable)
    );
}

#[test]
fn a_degradable_header_may_sit_beside_a_degraded_meta_field() {
    let degraded_meta = |ir: &mut Value| {
        set(
            ir,
            "/formats/bare/meta",
            "degraded",
            json!({
                "type": {"kind": "array", "items": {"kind": "scalar", "type": "string", "refinements": {}}},
                "fill": "degraded",
            }),
        );
    };

    assert_eq!(after(degraded_meta), Found::new());
    assert_eq!(
        after(|ir| {
            degraded_meta(ir);
            remove(ir, &format!("{UPDATE}/degradable"), "header");
        }),
        Found::new()
    );
}

#[test]
fn successor_rel_if_and_only_if_successor() {
    assert_eq!(
        after(|ir| remove(ir, DEPRECATED, "successorRel")),
        at(IrInvariantId::DeprecationHeaders, DEPRECATED)
    );
}

#[test]
fn a_deprecated_operations_responses_carry_its_deprecation_headers() {
    let response = format!("{UPDATE}/responses/0");
    let headers = format!("{response}/headers");

    assert_eq!(
        after(|ir| {
            list(ir, &headers).retain(|header| header["semantic"] != "sunset");
        }),
        at(IrInvariantId::DeprecationHeaders, &response)
    );
    assert_eq!(
        after(|ir| {
            let header = copy_of(ir, &format!("{headers}/1"));

            list(ir, &headers).push(header);
        }),
        at(IrInvariantId::DeprecationHeaders, &response)
    );
    // Without a successor, a successor link is one header too many.
    assert_eq!(
        after(|ir| {
            remove(ir, DEPRECATED, "successor");
            remove(ir, DEPRECATED, "successorRel");
        }),
        at(IrInvariantId::DeprecationHeaders, &response)
    );
}

#[test]
fn only_a_2xx_response_of_a_deprecated_operation_carries_deprecation_headers() {
    let redirect = |ir: &mut Value, headers: Vec<Value>| {
        list(ir, &format!("{UPDATE}/responses"))
            .push(json!({"status": 302, "shape": "empty", "headers": headers}));
    };
    let deprecation_header = |ir: &Value| copy_of(ir, &format!("{UPDATE}/responses/0/headers/1"));

    assert_eq!(after(|ir| redirect(ir, Vec::new())), Found::new());
    assert_eq!(
        after(|ir| {
            let header = deprecation_header(ir);

            redirect(ir, vec![header]);
        }),
        at(
            IrInvariantId::DeprecationHeaders,
            &format!("{UPDATE}/responses/1")
        )
    );
    assert_eq!(
        after(|ir| {
            let header = deprecation_header(ir);

            list(ir, "/operations/0/responses/0/headers").push(header);
        }),
        at(
            IrInvariantId::DeprecationHeaders,
            "/operations/0/responses/0"
        )
    );
}

#[test]
fn a_successor_in_the_same_api_names_an_operation_of_the_document() {
    let successor = format!("{DEPRECATED}/successor");

    assert_eq!(
        after(|ir| set(ir, &successor, "id", json!("nope"))),
        at(IrInvariantId::DeprecationHeaders, &successor)
    );
    // A successor in another api is checked at compile time only.
    assert_eq!(
        after(|ir| {
            set(ir, &successor, "api", json!("billing"));
            set(ir, &successor, "id", json!("nope"));
        }),
        Found::new()
    );
}

const TASK_ID: &str = "/operations/2/params/path/0";

// A successor updateTaskV2, an operation of the document with one path param.
fn with_successor(ir: &mut Value, param: &Value) {
    let mut successor = copy_of(ir, "/operations/1");

    successor["id"] = json!("updateTaskV2");
    successor["params"] = json!({"path": [param], "query": [], "header": []});
    list(ir, "/operations").push(successor);
    set(
        ir,
        &format!("{DEPRECATED}/successor"),
        "id",
        json!("updateTaskV2"),
    );
}

fn task_id_with(ir: &Value, member: &str, value: Value) -> Value {
    let mut param = copy_of(ir, TASK_ID);

    param[member] = value;

    param
}

#[test]
fn a_successors_path_params_are_the_deprecated_operations_of_the_same_type() {
    let successor = format!("{DEPRECATED}/successor");

    assert_eq!(
        after(|ir| {
            let param = copy_of(ir, TASK_ID);

            with_successor(ir, &param);
        }),
        Found::new()
    );
    assert_eq!(
        after(|ir| {
            let param = task_id_with(ir, "name", json!("projectId"));

            with_successor(ir, &param);
        }),
        at(IrInvariantId::DeprecationHeaders, &successor)
    );
    assert_eq!(
        after(|ir| {
            let integer = json!({"kind": "scalar", "type": "integer", "refinements": {}});
            let param = task_id_with(ir, "type", integer);

            with_successor(ir, &param);
        }),
        at(IrInvariantId::DeprecationHeaders, &successor)
    );
}

#[test]
fn a_successor_param_differing_only_in_docs_or_examples_is_the_same_type_use() {
    assert_eq!(
        after(|ir| {
            let mut annotated = copy_of(ir, &format!("{TASK_ID}/type"));

            annotated["docs"] = json!({"summary": "The task."});
            annotated["examples"] = json!(["t1"]);

            let param = task_id_with(ir, "type", annotated);

            with_successor(ir, &param);
        }),
        Found::new()
    );
}

#[test]
fn a_deprecations_since_is_not_after_its_sunset() {
    assert_eq!(
        after(|ir| set(ir, DEPRECATED, "since", json!("2027-02-01"))),
        at(IrInvariantId::DeprecationSince, DEPRECATED)
    );
    assert_eq!(
        after(|ir| {
            let sunset = copy_of(ir, &format!("{DEPRECATED}/sunset"));

            set(ir, DEPRECATED, "since", sunset);
        }),
        Found::new()
    );
}

#[test]
fn a_deprecation_date_that_is_no_calendar_day_breaks_since() {
    assert_eq!(
        after(|ir| {
            set(ir, DEPRECATED, "since", json!("2026-02-30"));
            set(ir, DEPRECATED, "sunset", json!("2027-02-29"));
        }),
        vec![
            (
                IrInvariantId::DeprecationSince,
                format!("{DEPRECATED}/since")
            ),
            (
                IrInvariantId::DeprecationSince,
                format!("{DEPRECATED}/sunset")
            ),
        ]
    );
}

fn task_use() -> Value {
    json!({"kind": "ref", "schema": "Task"})
}

fn storable(ir: &mut Value) {
    set(ir, &format!("{UPDATE}/cache"), "noStore", json!(false));
}

fn with_body(ir: &mut Value, body: Value) {
    storable(ir);
    set(ir, &format!("{UPDATE}/responses/0"), "body", body);
}

// Adds a schema, filling the members every schema and property of the document carries.
fn with_schema(ir: &mut Value, id: &str, mut schema: Value) {
    let origin = json!({"layer": "api", "pointer": format!("/schemas/{id}")});

    schema["id"] = json!(id);
    schema["name"] = json!({"segments": [id.to_lowercase()], "role": "schema"});
    schema["directions"] = json!(["output"]);
    schema["examples"] = json!([]);
    schema["docs"] = json!({});
    schema["extensions"] = json!({});
    schema["origin"] = origin.clone();

    if schema["kind"] == "union" {
        schema["tag"] = json!({"in": "body", "property": "kind"});
    }

    if let Some(properties) = schema["properties"].as_array_mut() {
        for property in properties {
            property["optional"] = json!(false);
            property["nullable"] = json!(false);
            property["deprecated"] = json!(false);
            property["docs"] = json!({});
            property["extensions"] = json!({});
            property["origin"] = origin.clone();
        }
    }

    set(ir, "/schemas", id, schema);
}

#[test]
fn an_operation_whose_response_carries_a_sensitive_field_sets_no_store() {
    assert_eq!(
        after(storable),
        at(IrInvariantId::CacheSensitiveNoStore, UPDATE)
    );
    assert_eq!(
        after(|ir| remove(ir, UPDATE, "cache")),
        at(IrInvariantId::CacheSensitiveNoStore, UPDATE)
    );
    assert_eq!(
        after(|ir| {
            storable(ir);
            set(ir, EFFORT, "sensitive", json!(false));
        }),
        Found::new()
    );
}

#[test]
fn a_sensitive_field_is_reached_through_items_json_content_map_values_and_union_variants() {
    let bodies = [
        json!({"kind": "array", "items": task_use()}),
        json!({"kind": "scalar", "type": "string", "refinements": {}, "content": {"media": "application/json", "schema": task_use()}}),
        json!({"kind": "ref", "schema": "TaskMap"}),
        json!({"kind": "ref", "schema": "TaskUnion"}),
    ];

    for body in bodies {
        let found = after(|ir| {
            with_schema(ir, "TaskMap", json!({"kind": "map", "values": task_use()}));
            with_schema(
                ir,
                "TaskUnion",
                json!({"kind": "union", "variants": [{"tag": "task", "schema": "Task"}]}),
            );
            with_body(ir, body.clone());
        });

        assert_eq!(
            found,
            at(IrInvariantId::CacheSensitiveNoStore, UPDATE),
            "{body}"
        );
    }
}

#[test]
fn a_sensitive_field_is_reached_through_a_propertys_type_a_later_union_variant_and_a_later_response()
 {
    let plain_use = json!({"kind": "ref", "schema": "Plain"});
    let schemas = |ir: &mut Value| {
        with_schema(ir, "Plain", json!({"kind": "object", "properties": []}));
        with_schema(
            ir,
            "Holder",
            json!({"kind": "object", "properties": [
                {"name": "tasks", "sensitive": false, "type": {"kind": "array", "items": task_use()}},
            ]}),
        );
        with_schema(
            ir,
            "PlainOrTask",
            json!({"kind": "union", "variants": [
                {"tag": "plain", "schema": "Plain"},
                {"tag": "task", "schema": "Task"},
            ]}),
        );
    };

    let through_holder = after(|ir| {
        schemas(ir);
        with_body(ir, json!({"kind": "ref", "schema": "Holder"}));
    });
    let through_union = after(|ir| {
        schemas(ir);
        with_body(ir, json!({"kind": "ref", "schema": "PlainOrTask"}));
    });
    let through_second_response = after(|ir| {
        schemas(ir);

        let mut second = copy_of(ir, &format!("{UPDATE}/responses/0"));

        second["status"] = json!(203);
        list(ir, &format!("{UPDATE}/responses")).push(second);
        with_body(ir, plain_use.clone());
    });

    for found in [through_holder, through_union, through_second_response] {
        assert_eq!(found, at(IrInvariantId::CacheSensitiveNoStore, UPDATE));
    }

    assert_eq!(
        after(|ir| {
            with_schema(ir, "Plain", json!({"kind": "object", "properties": []}));
            with_body(ir, plain_use.clone());
        }),
        Found::new()
    );
}

#[test]
fn a_sensitive_scalar_use_is_reached_as_a_body_its_items_a_map_key_and_a_header_type() {
    let secret_use =
        json!({"kind": "scalar", "type": "string", "refinements": {}, "sensitive": true});
    let plain_use = json!({"kind": "scalar", "type": "string", "refinements": {}});
    let secret_keys = json!({"kind": "map", "keys": secret_use, "values": plain_use});
    let prepare = |ir: &mut Value| {
        with_schema(ir, "SecretKeys", secret_keys.clone());
        set(ir, EFFORT, "sensitive", json!(false));
    };

    let bodies = [
        secret_use.clone(),
        json!({"kind": "array", "items": secret_use}),
        json!({"kind": "ref", "schema": "SecretKeys"}),
    ];

    for body in bodies {
        let found = after(|ir| {
            prepare(ir);
            with_body(ir, body.clone());
        });

        assert_eq!(
            found,
            at(IrInvariantId::CacheSensitiveNoStore, UPDATE),
            "{body}"
        );
    }

    let header = after(|ir| {
        prepare(ir);
        storable(ir);
        list(ir, &format!("{UPDATE}/responses/0/headers"))
            .push(json!({"name": "X-Token", "type": secret_use, "required": true}));
    });

    assert_eq!(header, at(IrInvariantId::CacheSensitiveNoStore, UPDATE));

    assert_eq!(
        after(|ir| {
            let mut plain_keys = secret_keys.clone();

            plain_keys["keys"] = plain_use.clone();
            with_schema(ir, "PlainKeys", plain_keys);
            with_body(ir, json!({"kind": "ref", "schema": "PlainKeys"}));
        }),
        Found::new()
    );
}

#[test]
fn an_error_code_whose_params_carry_a_sensitive_value_sets_no_store() {
    let declaration = "/errors/tasks.locked";
    let secret_use =
        json!({"kind": "scalar", "type": "string", "refinements": {}, "sensitive": true});
    let params_of = |ir: &mut Value, schema: &str| {
        set(ir, declaration, "params", json!(schema));
        remove(ir, declaration, "noStore");
    };

    assert_eq!(
        after(|ir| params_of(ir, "Task")),
        at(IrInvariantId::ErrorSensitiveNoStore, declaration)
    );
    assert_eq!(
        after(|ir| {
            with_schema(
                ir,
                "SecretKeys",
                json!({"kind": "map", "keys": secret_use, "values": secret_use}),
            );
            with_schema(
                ir,
                "SecretHolder",
                json!({"kind": "object", "properties": [
                    {"name": "keys", "sensitive": false, "type": {"kind": "ref", "schema": "SecretKeys"}},
                ]}),
            );
            params_of(ir, "SecretHolder");
        }),
        at(IrInvariantId::ErrorSensitiveNoStore, declaration)
    );
    assert_eq!(
        after(|ir| {
            params_of(ir, "Task");
            set(ir, declaration, "noStore", json!(true));
        }),
        Found::new()
    );
    assert_eq!(after(|ir| params_of(ir, "LockedParams")), Found::new());
}

#[test]
fn a_recursive_schema_without_a_sensitive_field_ends() {
    assert_eq!(
        after(|ir| {
            with_schema(
                ir,
                "Loop",
                json!({"kind": "object", "properties": [
                    {"name": "next", "sensitive": false, "type": {"kind": "ref", "schema": "Loop"}},
                ]}),
            );
            with_body(ir, json!({"kind": "ref", "schema": "Loop"}));
        }),
        Found::new()
    );
}

fn each(inner: &Value) -> Value {
    json!({"kind": "each", "of": "issues", "as": inner})
}

fn item() -> Value {
    json!({"kind": "slot", "slot": "item", "path": ["pointer"]})
}

#[test]
fn a_role_binds_one_code_per_operation() {
    assert_eq!(
        after(|ir| list(ir, &format!("{INTERNAL}/roles")).push(json!({"role": "stateConflict"}))),
        at(
            IrInvariantId::OperationRoleOnce,
            &format!("{INTERNAL}/roles/1")
        )
    );
}

#[test]
fn a_role_twice_in_one_element_breaks_role_once() {
    assert_eq!(
        after(|ir| list(ir, &format!("{INTERNAL}/roles")).push(json!({"role": "undeclaredStatus"}))),
        at(
            IrInvariantId::OperationRoleOnce,
            &format!("{INTERNAL}/roles/1")
        )
    );
}

#[test]
fn role_params_if_and_only_if_the_code_declares_params() {
    assert_eq!(
        after(|ir| {
            remove(ir, &format!("{LOCKED}/roles/0"), "params");
            set(
                ir,
                &format!("{INTERNAL}/roles/0"),
                "params",
                json!({"kind": "object", "members": []}),
            );
        }),
        vec![
            (IrInvariantId::ErrorRoleParams, format!("{LOCKED}/roles/0")),
            (
                IrInvariantId::ErrorRoleParams,
                format!("{INTERNAL}/roles/0")
            ),
        ]
    );
}

#[test]
fn a_nested_each_in_role_params_breaks_role_params() {
    assert_eq!(
        after(|ir| set(
            ir,
            &format!("{LOCKED}/roles/0"),
            "params",
            json!({"kind": "object", "members": [
                {"name": {"kind": "text", "text": "issues"}, "value": each(&each(&item()))},
            ]}),
        )),
        at(
            IrInvariantId::ErrorRoleParams,
            &format!("{LOCKED}/roles/0/params/members/0/value/as")
        )
    );
    // Two lists side by side are no nesting.
    assert_eq!(
        after(|ir| set(
            ir,
            &format!("{LOCKED}/roles/0"),
            "params",
            json!({"kind": "array", "items": [each(&item()), each(&item())]}),
        )),
        Found::new()
    );
}

fn both_retry_headers() -> Found {
    vec![
        (
            IrInvariantId::ErrorRetryHeader,
            "/operations/0/errors/0/retryHeader".to_owned(),
        ),
        (
            IrInvariantId::ErrorRetryHeader,
            format!("{THROTTLED}/retryHeader"),
        ),
    ]
}

fn retry_violations(change: impl FnOnce(&mut Value)) -> Found {
    of(after(change), IrInvariantId::ErrorRetryHeader)
}

#[test]
fn a_retry_header_on_a_bucket_429_with_a_safe_integer_param_is_valid() {
    assert_eq!(after(|_| {}), Found::new());
}

#[test]
fn a_retry_header_on_a_non_429_code_breaks_retry_header() {
    assert_eq!(
        retry_violations(|ir| set(ir, "/errors/tasks.throttled/http", "status", json!(503))),
        both_retry_headers()
    );
}

#[test]
fn a_retry_header_naming_an_optional_or_nullable_param_breaks_retry_header() {
    assert_eq!(
        retry_violations(|ir| set(ir, RETRY_AFTER, "optional", json!(true))),
        both_retry_headers()
    );
    assert_eq!(
        retry_violations(|ir| set(ir, RETRY_AFTER, "nullable", json!(true))),
        both_retry_headers()
    );
    assert_eq!(
        retry_violations(|ir| set(
            ir,
            &format!("{THROTTLED}/retryHeader"),
            "param",
            json!("missing")
        )),
        at(
            IrInvariantId::ErrorRetryHeader,
            &format!("{THROTTLED}/retryHeader")
        )
    );
}

#[test]
fn a_retry_header_with_a_non_integer_param_breaks_retry_header() {
    assert_eq!(
        retry_violations(|ir| set(
            ir,
            RETRY_AFTER,
            "type",
            json!({"kind": "scalar", "type": "number", "refinements": {"minimum": "0"}}),
        )),
        both_retry_headers()
    );
    assert_eq!(
        retry_violations(|ir| set(ir, &format!("{RETRY_AFTER}/type"), "format", json!("int64"))),
        both_retry_headers()
    );
}

#[test]
fn a_retry_header_with_a_param_without_minimum_or_with_a_negative_minimum_breaks_retry_header() {
    let refinements = format!("{RETRY_AFTER}/type/refinements");

    assert_eq!(
        retry_violations(|ir| remove(ir, &refinements, "minimum")),
        both_retry_headers()
    );
    assert_eq!(
        retry_violations(|ir| set(ir, &refinements, "minimum", json!("-1"))),
        both_retry_headers()
    );
}

#[test]
fn a_retry_header_with_a_param_without_maximum_or_past_the_safe_maximum_breaks_retry_header() {
    let refinements = format!("{RETRY_AFTER}/type/refinements");

    assert_eq!(
        retry_violations(|ir| remove(ir, &refinements, "maximum")),
        both_retry_headers()
    );

    for maximum in ["9007199254740992", "1e300"] {
        assert_eq!(
            retry_violations(|ir| set(ir, &refinements, "maximum", json!(maximum))),
            both_retry_headers(),
            "{maximum}"
        );
    }
}

#[test]
fn a_retry_header_derived_from_another_derivation_breaks_retry_header() {
    let header = format!("{THROTTLED}/retryHeader");

    assert_eq!(
        retry_violations(|ir| set(
            ir,
            &format!("{header}/derivedFrom"),
            "derivation",
            json!("requirement.errors"),
        )),
        at(IrInvariantId::ErrorRetryHeader, &header)
    );
}
