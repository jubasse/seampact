//! The ported cases of the TypeScript template reader tests, and the slot spelling edges.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    reason = "test code: a failed lookup is the failed test"
)]

use seampact_ir::Template;
use seampact_json::JsonValue;
use seampact_templates::{
    TemplateFault, TemplateRule, TemplateSite, TemplateSlot, TemplateSlotKind, template_read,
    template_slots, template_uses,
};

fn slot(name: &str, kind: TemplateSlotKind) -> TemplateSlot {
    TemplateSlot {
        name: name.to_owned(),
        kind,
    }
}

fn place_slots() -> Vec<TemplateSlot> {
    vec![
        slot("code", TemplateSlotKind::Value),
        slot("params", TemplateSlotKind::Object),
        slot("list", TemplateSlotKind::Array),
    ]
}

fn element_slots() -> Vec<TemplateSlot> {
    vec![slot("item", TemplateSlotKind::Value)]
}

fn json(text: &str) -> JsonValue {
    serde_json::from_str(text).expect("JSON text")
}

fn template_json(template: &Template) -> serde_json::Value {
    serde_json::to_value(template).expect("a template serialises")
}

struct Read {
    template: Option<Template>,
    faults: Vec<TemplateFault>,
}

impl Read {
    fn rules(&self) -> Vec<(&'static str, &str)> {
        self.faults
            .iter()
            .map(|fault| (fault.rule.as_str(), fault.pointer.as_str()))
            .collect()
    }

    fn fixes(&self) -> Vec<&str> {
        self.faults.iter().map(|fault| fault.fix.as_str()).collect()
    }
}

fn read_with(value: &str, slots: &[TemplateSlot], each_slots: &[TemplateSlot]) -> Read {
    let mut faults = Vec::new();
    let template = {
        let mut report = |fault: TemplateFault| faults.push(fault);
        let mut site = TemplateSite {
            slots,
            each_slots,
            owner: "the role notFound",
            place_name: "a role binding",
            example_slot: "$params",
            adr_sections: "ADR 0002 section 13",
            report: &mut report,
        };

        template_read(&mut site, &json(value), "/t")
    };

    Read { template, faults }
}

fn read(value: &str) -> Read {
    read_with(value, &place_slots(), &element_slots())
}

#[test]
fn reads_slots_text_parts_member_names_merges_and_arrays_of_the_callers_slots() {
    let result = read(
        r#"{"$merge":"$params","title":"Missing ${code.name} ($$5)","$$raw":"$code","rows":{"$each":"$list","$as":["$item",3]}}"#,
    );
    let template = result.template.expect("a template");

    assert_eq!(result.faults, Vec::<TemplateFault>::new());
    assert_eq!(
        template_json(&template),
        serde_json::json!({
            "kind": "object",
            "merge": "params",
            "members": [
                {
                    "name": {"kind": "text", "text": "title"},
                    "value": {"kind": "text", "parts": [
                        {"kind": "text", "text": "Missing "},
                        {"kind": "slot", "slot": "code", "path": ["name"]},
                        {"kind": "text", "text": " ($5)"}
                    ]}
                },
                {
                    "name": {"kind": "text", "text": "$raw"},
                    "value": {"kind": "slot", "slot": "code", "path": []}
                },
                {
                    "name": {"kind": "text", "text": "rows"},
                    "value": {"kind": "each", "of": "list", "as": {"kind": "array", "items": [
                        {"kind": "slot", "slot": "item", "path": []},
                        {"kind": "literal", "value": 3}
                    ]}}
                }
            ]
        })
    );

    let used: Vec<String> = template_slots(&template)
        .expect("slots")
        .into_iter()
        .map(|used| used.slot)
        .collect();

    assert_eq!(used, ["params", "code", "code", "list", "item"]);
    assert_eq!(template_uses(&template, "list"), Ok(true));
    assert_eq!(template_uses(&template, "nature"), Ok(false));
}

#[test]
fn reads_a_value_that_is_no_text_array_or_object_as_a_literal() {
    assert_eq!(
        read("null")
            .template
            .map(|template| template_json(&template)),
        Some(serde_json::json!({"kind": "literal", "value": null}))
    );
    assert_eq!(
        read("true")
            .template
            .map(|template| template_json(&template)),
        Some(serde_json::json!({"kind": "literal", "value": true}))
    );
    assert_eq!(
        read(r#""plain $$ text""#)
            .template
            .map(|template| template_json(&template)),
        Some(serde_json::json!({"kind": "literal", "value": "plain $ text"}))
    );
}

#[test]
fn refuses_a_slot_the_place_does_not_fill_and_an_element_slot_outside_as() {
    let result = read(r#"{"a":"$nature","b":"${item}"}"#);

    assert!(result.template.is_none());
    assert_eq!(
        result.rules(),
        [("template-slot", "/t/a"), ("template-slot", "/t/b")]
    );
    assert_eq!(
        result.faults.first().map(|fault| fault.message.as_str()),
        Some(
            "The template of the role notFound writes the slot '$nature', which a role binding does not fill."
        )
    );
    assert_eq!(
        result.faults.first().map(|fault| fault.fix.as_str()),
        Some(
            "Use a slot of a role binding (ADR 0002 section 13), or write '$$nature' for the literal text."
        )
    );
}

#[test]
fn refuses_the_syntax_faults_where_they_are_written() {
    let result = read(r#"{"a":"costs $5","$9":"x","b":{"$each":"$list"},"$merge":"$params.name"}"#);

    assert_eq!(
        result.rules(),
        [
            ("template-syntax", "/t/a"),
            ("template-syntax", "/t/$9"),
            ("template-syntax", "/t/b"),
            ("template-syntax", "/t/$merge"),
        ]
    );
    assert_eq!(
        result.faults.first().map(|fault| fault.message.as_str()),
        Some(
            "The template of the role notFound is not valid: the text 'costs $5' writes a $ that starts no slot."
        )
    );
    assert_eq!(
        result.faults.get(2).map(|fault| fault.message.as_str()),
        Some(
            "The template of the role notFound is not valid: an array template is { $each, $as } and nothing else."
        )
    );
}

#[test]
fn refuses_a_slot_whose_kind_does_not_fit_where_it_stands_naming_the_slots_that_fit() {
    let result = read(r#"{"$merge":"$code","a":{"$each":"$params","$as":"$item"}}"#);

    assert_eq!(
        result.rules(),
        [
            ("template-merge", "/t/$merge"),
            ("template-each", "/t/a/$each")
        ]
    );
    assert_eq!(
        result.fixes(),
        [
            "Merge an object slot ($params), or write the slot as a member.",
            "Map an array slot ($list), or write the slot as a member.",
        ]
    );
    assert_eq!(
        result.faults.first().map(|fault| fault.message.as_str()),
        Some("The template of the role notFound merges '$code', which holds no object.")
    );
}

#[test]
fn says_so_when_no_slot_of_the_place_fits_the_stand() {
    let result = read(r#"{"$code":1}"#);

    assert_eq!(result.rules(), [("template-name", "/t/$code")]);
    assert_eq!(
        result.fixes(),
        [
            "Write '$code' as a member: a role binding fills no slot that holds a name. Write $$ for a literal $."
        ]
    );

    let named = read_with(
        r#"{"$name":1}"#,
        &[slot("name", TemplateSlotKind::Name)],
        &element_slots(),
    );

    assert_eq!(named.faults, Vec::<TemplateFault>::new());
}

#[test]
fn quotes_and_bounds_a_slot_name_written_in_a_message() {
    let long = "a".repeat(200);
    let result = read(&format!(r#"{{"a":"${long}"}}"#));
    let message = result.faults.first().map(|fault| fault.message.clone());
    let message = message.expect("a fault");

    assert!(message.contains(&format!("'${}…'", "a".repeat(79))));
    assert!(!message.contains(&long));
}

#[test]
fn lists_the_element_slots_as_fitting_only_inside_as() {
    let element = [slot("itemFields", TemplateSlotKind::Object)];
    let mut faults = Vec::new();
    let place = place_slots();

    for text in [
        r#"{"$merge":"$code"}"#,
        r#"{"rows":{"$each":"$list","$as":{"$merge":"$code"}}}"#,
    ] {
        let mut report = |fault: TemplateFault| faults.push(fault);
        let mut site = TemplateSite {
            slots: &place,
            each_slots: &element,
            owner: "the role notFound",
            place_name: "a role binding",
            example_slot: "$params",
            adr_sections: "ADR 0002 section 13",
            report: &mut report,
        };

        template_read(&mut site, &json(text), "/t");
    }

    let fixes: Vec<&str> = faults.iter().map(|fault| fault.fix.as_str()).collect();

    assert_eq!(
        fixes,
        [
            "Merge an object slot ($params), or write the slot as a member.",
            "Merge an object slot ($params, $itemFields), or write the slot as a member.",
        ]
    );
}

#[test]
fn a_fault_inside_as_still_refuses_the_whole_template() {
    let result = read(r#"{"rows":{"$each":"$list","$as":"$nature"}}"#);

    assert!(result.template.is_none());
    assert_eq!(result.rules(), [("template-slot", "/t/rows/$as")]);
}

#[test]
fn slot_spellings_follow_the_ascii_classes_exactly() {
    let slots = [
        slot("a", TemplateSlotKind::Value),
        slot("a1", TemplateSlotKind::Value),
    ];
    let reads = |text: &str| read_with(text, &slots, &[]).template.is_some();

    assert!(reads(r#""$a""#));
    assert!(reads(r#""$a1""#));
    assert!(reads(r#""$a.b_c.D9""#));
    assert!(reads(r#""$a._x""#));
    // A path member cannot start with a digit; the dot is left over, so the whole is no slot.
    assert!(!reads(r#""$a.1""#));
    assert!(!reads(r#""$a.""#));
    assert!(!reads(r#""$1a""#));
    assert!(!reads(r#""$é""#));
    assert!(!reads(r#""$a\n""#));
    assert!(!reads(r#""$a b""#));
    // Inside a text the closing brace ends the slot; a malformed one is refused.
    assert!(reads(r#""x ${a.b} y ${a1}""#));
    assert!(!reads(r#""x ${a.} y""#));
    assert!(!reads(r#""x ${é} y""#));
    assert!(!reads(r#""x ${a""#));
    assert!(!reads(r#""x $a y""#));
    // `$$$a` is a literal `$` then a `$` that starts no slot.
    assert!(!reads(r#""$$$a""#));
    assert!(reads(r#""$$a""#));
}

#[test]
fn member_names_are_read_in_javascript_key_order() {
    let result = read(r#"{"b":1,"2":2,"a":3,"1":4}"#);
    let template = result.template.expect("a template");
    let value = template_json(&template);
    let names: Vec<&str> = value["members"]
        .as_array()
        .expect("members")
        .iter()
        .filter_map(|member| member["name"]["text"].as_str())
        .collect();

    assert_eq!(names, ["1", "2", "b", "a"]);
}

#[test]
fn a_template_of_an_unknown_kind_is_an_internal_error() {
    let unknown: Template = serde_json::from_str(r#"{"kind":"widget"}"#).expect("an open template");
    let error = template_slots(&unknown).expect_err("refused");

    assert!(error.to_string().contains("widget"));
    assert!(template_uses(&unknown, "a").is_err());
}

#[test]
fn rules_are_spelled_as_the_callers_map_them() {
    let spelled: Vec<&str> = [
        TemplateRule::Slot,
        TemplateRule::Syntax,
        TemplateRule::Merge,
        TemplateRule::Each,
        TemplateRule::Name,
    ]
    .map(TemplateRule::as_str)
    .to_vec();

    assert_eq!(
        spelled,
        [
            "template-slot",
            "template-syntax",
            "template-merge",
            "template-each",
            "template-name"
        ]
    );
}
