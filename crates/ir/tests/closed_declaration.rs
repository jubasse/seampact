//! The closed-declaration check on typed declarations read from the every-member example.

use seampact_ir::{
    Enum, ExtensionKeyDecl, IrClosedCheck, IrClosedDeclaration, IrClosedUnknown, Operation,
    PagingStyle, Scalar, Schema, TypeUse, WireFormat, check_ir_closed_declaration,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const EVERY_MEMBER_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/every-member.ir.json");

#[expect(
    clippy::unwrap_used,
    reason = "a test helper: a broken example fails the test"
)]
fn every_member() -> Value {
    serde_json::from_str(EVERY_MEMBER_EXAMPLE).unwrap()
}

#[expect(
    clippy::unwrap_used,
    reason = "a test helper: a broken example fails the test"
)]
fn declaration_at(pointer: &str) -> Value {
    every_member().pointer(pointer).unwrap().clone()
}

#[expect(
    clippy::unwrap_used,
    reason = "a test helper: a broken example fails the test"
)]
fn decoded<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).unwrap()
}

#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "a test helper: a failed check fails the test"
)]
fn unknowns_of<T: IrClosedDeclaration + std::fmt::Debug>(
    declaration: &T,
    pointer: &str,
) -> Vec<IrClosedUnknown> {
    match check_ir_closed_declaration(declaration, pointer).unwrap() {
        IrClosedCheck::Unknowns(unknowns) => unknowns,
        IrClosedCheck::Closed(closed) => panic!("closed, unknowns expected: {closed:?}"),
    }
}

fn unknown(pointer: &str, value: &str) -> IrClosedUnknown {
    IrClosedUnknown {
        pointer: pointer.to_owned(),
        value: value.to_owned(),
    }
}

#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "a test helper: a failed check fails the test"
)]
fn assert_closed<T: IrClosedDeclaration + DeserializeOwned + std::fmt::Debug>(pointer: &str) {
    let declaration: T = decoded(declaration_at(pointer));
    let check = check_ir_closed_declaration(&declaration, pointer).unwrap();

    let IrClosedCheck::Closed(closed) = check else {
        panic!("{pointer} holds an unknown: {check:?}");
    };

    assert!(
        std::ptr::eq(closed, std::ptr::from_ref(&declaration)),
        "{pointer} is answered as given"
    );
}

#[test]
fn every_known_declaration_of_the_example_is_closed_and_answered_as_given() {
    assert_closed::<Schema>("/schemas/Task");
    assert_closed::<Schema>("/schemas/Labels");
    assert_closed::<Schema>("/schemas/Notice");
    assert_closed::<Enum>("/enums/Mirror");
    assert_closed::<Scalar>("/scalars/money");
    assert_closed::<WireFormat>("/formats/bare");
    assert_closed::<ExtensionKeyDecl>("/extensionKeys/acme-owner");
    assert_closed::<PagingStyle>("/pagings/cursor");
    assert_closed::<Operation>("/operations/0");
}

#[test]
fn a_known_type_use_is_closed() {
    let type_use: TypeUse = decoded(json!({"kind": "ref", "schema": "Labels"}));

    assert!(matches!(
        check_ir_closed_declaration(&type_use, "/type"),
        Ok(IrClosedCheck::Closed(_))
    ));
}

#[test]
fn an_unknown_schema_kind_is_reported_at_its_tag() {
    let mut task = declaration_at("/schemas/Task");

    task["kind"] = json!("tuple");

    let schema: Schema = decoded(task);

    assert_eq!(
        unknowns_of(&schema, "/schemas/Task"),
        vec![unknown("/schemas/Task/kind", "tuple")]
    );
}

#[test]
fn an_unknown_enum_value_form_is_reported_at_its_tag() {
    let mut mirror = declaration_at("/enums/Mirror");

    mirror["source"] = json!({"kind": "registry", "registry": "states"});

    let enumeration: Enum = decoded(mirror);

    assert_eq!(
        unknowns_of(&enumeration, "/enums/Mirror"),
        vec![unknown("/enums/Mirror/source/kind", "registry")]
    );
}

#[test]
fn an_unknown_open_enum_value_is_reported_with_its_pointer() {
    let mut money = declaration_at("/scalars/money");

    money["directions"] = json!(["input", "sideways"]);

    let scalar: Scalar = decoded(money);

    assert_eq!(
        unknowns_of(&scalar, "/scalars/money"),
        vec![unknown("/scalars/money/directions/1", "sideways")]
    );
}

#[test]
fn an_unknown_use_nested_in_a_property_is_reported_with_every_other_unknown() {
    let mut task = declaration_at("/schemas/Task");
    let mut property = task["properties"][0].clone();

    property["type"] = json!({"kind": "set"});
    task["directions"] = json!(["both"]);
    task["properties"] = json!([property]);

    let schema: Schema = decoded(task);

    assert_eq!(
        unknowns_of(&schema, "/schemas/Task"),
        vec![
            unknown("/schemas/Task/directions/0", "both"),
            unknown("/schemas/Task/properties/0/type/kind", "set"),
        ]
    );
}

#[test]
fn an_unknown_variant_nested_in_an_operation_is_reported() {
    let mut operation = declaration_at("/operations/0");

    operation["unknownQuery"] = json!({"policy": "ignore-all"});

    let operation: Operation = decoded(operation);

    assert_eq!(
        unknowns_of(&operation, "/operations/0"),
        vec![unknown("/operations/0/unknownQuery/policy", "ignore-all")]
    );
}

#[test]
fn an_unknown_type_use_kind_is_reported_and_cut_to_the_bound() {
    let set: TypeUse = decoded(json!({"kind": "set"}));
    let long: TypeUse = decoded(json!({"kind": "k".repeat(500)}));

    assert_eq!(
        unknowns_of(&set, "/type"),
        vec![unknown("/type/kind", "set")]
    );
    assert_eq!(
        unknowns_of(&long, "/type"),
        vec![unknown("/type/kind", &format!("{}...", "k".repeat(64)))]
    );
}

#[test]
fn a_member_the_types_do_not_declare_is_dropped_on_decode_and_never_reported() {
    let mut style = declaration_at("/pagings/cursor");

    style["zzLater"] = json!(true);

    let style: PagingStyle = decoded(style);

    assert!(matches!(
        check_ir_closed_declaration(&style, "/pagings/cursor"),
        Ok(IrClosedCheck::Closed(_))
    ));
}
