//! The closed-declaration check on declarations of the every-member example, read in the document
//! they decode from.

use seampact_ir::{
    Enum, ExtensionKeyDecl, ImportedIr, IrClosedCheck, IrClosedDeclaration, IrClosedUnknown,
    IrError, Operation, PagingStyle, Scalar, Schema, TypeUse, WireFormat,
    check_ir_closed_declaration,
};
use seampact_json::JsonValue;
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

// The every-member example with `declaration` at `pointer`, or under a new top-level member for a
// pointer the example does not hold.
#[expect(
    clippy::unwrap_used,
    reason = "a test helper: a broken example fails the test"
)]
fn document_with(declaration: &Value, pointer: &str) -> JsonValue {
    let mut document = every_member();

    if let Some(slot) = document.pointer_mut(pointer) {
        *slot = declaration.clone();
    } else {
        let member = pointer.trim_start_matches('/').to_owned();

        document
            .as_object_mut()
            .unwrap()
            .insert(member, declaration.clone());
    }

    JsonValue::try_from(document).unwrap()
}

#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "a test helper: a failed check fails the test"
)]
fn unknowns_of<T: IrClosedDeclaration + DeserializeOwned + std::fmt::Debug>(
    declaration: Value,
    pointer: &str,
) -> Vec<IrClosedUnknown> {
    let document = document_with(&declaration, pointer);
    let typed: T = decoded(declaration);

    match check_ir_closed_declaration(&typed, &document, pointer).unwrap() {
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
    let document = document_with(&declaration_at(pointer), pointer);
    let declaration: T = decoded(declaration_at(pointer));
    let check = check_ir_closed_declaration(&declaration, &document, pointer).unwrap();

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
    let read = json!({"kind": "ref", "schema": "Labels"});
    let document = document_with(&read, "/type");
    let type_use: TypeUse = decoded(read);

    assert!(matches!(
        check_ir_closed_declaration(&type_use, &document, "/type"),
        Ok(IrClosedCheck::Closed(_))
    ));
}

#[test]
fn an_unknown_schema_kind_is_reported_at_its_tag() {
    let mut task = declaration_at("/schemas/Task");

    task["kind"] = json!("tuple");

    assert_eq!(
        unknowns_of::<Schema>(task, "/schemas/Task"),
        vec![unknown("/schemas/Task/kind", "tuple")]
    );
}

#[test]
fn an_unknown_enum_value_form_is_reported_at_its_tag() {
    let mut mirror = declaration_at("/enums/Mirror");

    mirror["source"] = json!({"kind": "registry", "registry": "states"});

    assert_eq!(
        unknowns_of::<Enum>(mirror, "/enums/Mirror"),
        vec![unknown("/enums/Mirror/source/kind", "registry")]
    );
}

#[test]
fn an_unknown_open_enum_value_is_reported_with_its_pointer() {
    let mut money = declaration_at("/scalars/money");

    money["directions"] = json!(["input", "sideways"]);

    assert_eq!(
        unknowns_of::<Scalar>(money, "/scalars/money"),
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

    assert_eq!(
        unknowns_of::<Schema>(task, "/schemas/Task"),
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

    assert_eq!(
        unknowns_of::<Operation>(operation, "/operations/0"),
        vec![unknown("/operations/0/unknownQuery/policy", "ignore-all")]
    );
}

#[test]
fn an_unknown_type_use_kind_is_reported_and_cut_to_the_bound() {
    assert_eq!(
        unknowns_of::<TypeUse>(json!({"kind": "set"}), "/type"),
        vec![unknown("/type/kind", "set")]
    );
    assert_eq!(
        unknowns_of::<TypeUse>(json!({"kind": "k".repeat(500)}), "/type"),
        vec![unknown("/type/kind", &format!("{}...", "k".repeat(64)))]
    );
}

#[test]
fn a_member_the_types_do_not_declare_is_reported_from_the_document() {
    let mut style = declaration_at("/pagings/cursor");

    style["zzLater"] = json!(true);

    assert_eq!(
        unknowns_of::<PagingStyle>(style, "/pagings/cursor"),
        vec![unknown("/pagings/cursor/zzLater", "zzLater")]
    );
}

#[expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "a test helper: a broken example or a failed check fails the test"
)]
fn imported_operation_unknowns(change: impl FnOnce(&mut Value)) -> Vec<IrClosedUnknown> {
    let mut document = every_member();

    change(document.pointer_mut("/operations/0").unwrap());

    let imported = ImportedIr::from_json_text(&document.to_string()).unwrap();
    let operation = imported.contract().operations.first().unwrap();

    match check_ir_closed_declaration(operation, imported.document(), "/operations/0").unwrap() {
        IrClosedCheck::Unknowns(unknowns) => unknowns,
        IrClosedCheck::Closed(closed) => panic!("closed, unknowns expected: {closed:?}"),
    }
}

#[test]
fn an_unknown_member_of_an_imported_operation_is_reported() {
    let unknowns = imported_operation_unknowns(|operation| operation["zzLater"] = json!(1));

    assert_eq!(unknowns, vec![unknown("/operations/0/zzLater", "zzLater")]);
}

#[test]
fn an_unknown_union_tag_of_an_imported_operation_is_reported() {
    let unknowns =
        imported_operation_unknowns(|operation| operation["access"]["kind"] = json!("delegated"));

    assert_eq!(
        unknowns,
        vec![unknown("/operations/0/access/kind", "delegated")]
    );
}

#[test]
fn an_unknown_open_enum_value_of_an_imported_operation_is_reported() {
    let unknowns =
        imported_operation_unknowns(|operation| operation["callerKinds"] = json!(["robot"]));

    assert_eq!(
        unknowns,
        vec![unknown("/operations/0/callerKinds/0", "robot")]
    );
}

#[test]
fn every_unknown_kind_of_an_imported_operation_is_reported_in_document_order() {
    let unknowns = imported_operation_unknowns(|operation| {
        operation["callerKinds"] = json!(["robot"]);
        operation["zzLater"] = json!(1);
        operation["access"]["kind"] = json!("delegated");
    });

    assert_eq!(
        unknowns,
        vec![
            unknown("/operations/0/zzLater", "zzLater"),
            unknown("/operations/0/access/kind", "delegated"),
            unknown("/operations/0/callerKinds/0", "robot"),
        ]
    );
}

#[test]
fn a_pointer_naming_nothing_in_the_document_is_an_error() {
    let imported = ImportedIr::from_json_text(EVERY_MEMBER_EXAMPLE);
    let Ok(imported) = imported else {
        panic!("the example reads: {imported:?}");
    };
    let operation = &imported.contract().operations[0];

    assert!(matches!(
        check_ir_closed_declaration(operation, imported.document(), "/operations/9"),
        Err(IrError::DeclarationNotInDocument { .. })
    ));
}
