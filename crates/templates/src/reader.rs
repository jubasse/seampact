//! Reading a raw template into the IR's template (ADR 0002 section 13).

use seampact_diagnostics::quote_text;
use seampact_ir::{
    ArrayTemplate, EachTemplate, LiteralTemplate, MemberName, ObjectTemplate, ObjectTemplateMember,
    PlainMemberName, PlainTextPart, Slot, SlotMemberName, SlotTemplate, SlotTextPart, Template,
    TextPart, TextTemplate,
};
use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue};

use crate::{
    checks::{Reading, SlotStand, check_slot, check_stand, refuse_syntax},
    site::TemplateSite,
    slot_syntax::{name_slot, path_of, text_slot, whole_slot},
};

const MERGE_KEY: &str = "$merge";
const EACH_KEY: &str = "$each";
const AS_KEY: &str = "$as";

/// The two keys that take a whole slot without a member path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SlotKey {
    Merge,
    Each,
}

impl SlotKey {
    const fn key(self) -> &'static str {
        match self {
            Self::Merge => MERGE_KEY,
            Self::Each => EACH_KEY,
        }
    }

    const fn stand(self) -> SlotStand {
        match self {
            Self::Merge => SlotStand::Merge,
            Self::Each => SlotStand::Each,
        }
    }
}

/// The template written at `pointer`, `None` when it is refused (each fault reported where it is
/// written).
///
/// Everything the template keeps is copied from `value`.
pub fn template_read(
    site: &mut TemplateSite<'_>,
    value: &JsonValue,
    pointer: &str,
) -> Option<Template> {
    let mut reading = Reading {
        site,
        in_each: false,
        faults: 0,
    };
    let template = template_of(&mut reading, value, pointer);

    if reading.faults == 0 { template } else { None }
}

fn template_of(
    reading: &mut Reading<'_, '_>,
    value: &JsonValue,
    pointer: &str,
) -> Option<Template> {
    match value {
        JsonValue::String(text) => string_template(reading, text, pointer),
        JsonValue::Array(items) => {
            let mut templates = Vec::new();

            for (index, item) in items.iter().enumerate() {
                if let Some(template) = template_of(reading, item, &format!("{pointer}/{index}")) {
                    templates.push(template);
                }
            }

            Some(Template::Array(ArrayTemplate { items: templates }))
        }
        JsonValue::Object(object) => object_template(reading, object, pointer),
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) => {
            Some(Template::Literal(LiteralTemplate {
                value: value.clone(),
            }))
        }
    }
}

fn string_template(reading: &mut Reading<'_, '_>, value: &str, pointer: &str) -> Option<Template> {
    if let Some(whole) = whole_slot(value) {
        if !check_slot(reading, whole.name, pointer) {
            return None;
        }

        return Some(Template::Slot(SlotTemplate {
            slot: Slot::new(whole.name.to_owned()),
            path: path_of(whole.path),
        }));
    }

    let parts = text_parts(reading, value, pointer)?;

    if parts.iter().all(|part| matches!(part, TextPart::Text(_))) {
        let literal: String = parts
            .iter()
            .map(|part| match part {
                TextPart::Text(plain) => plain.text.as_str(),
                _ => "",
            })
            .collect();

        return Some(Template::Literal(LiteralTemplate {
            value: JsonValue::String(literal),
        }));
    }

    Some(Template::Text(TextTemplate { parts }))
}

// `$$` writes a literal `$`, `${name}` a slot's text; any other `$` is refused, since it reads
// like a slot.
fn text_parts(reading: &mut Reading<'_, '_>, value: &str, pointer: &str) -> Option<Vec<TextPart>> {
    let mut parts = Vec::new();
    let mut text = String::new();
    let mut rest = value;

    while !rest.is_empty() {
        let Some((before, after_dollar)) = rest.split_once('$') else {
            text.push_str(rest);

            break;
        };

        text.push_str(before);

        if let Some(after_pair) = after_dollar.strip_prefix('$') {
            text.push('$');
            rest = after_pair;

            continue;
        }

        let Some(slot) = text_slot(after_dollar) else {
            return refuse_syntax(
                reading,
                pointer,
                &format!(
                    "the text {} writes a $ that starts no slot",
                    quote_text(value)
                ),
            );
        };

        if !check_slot(reading, slot.name, pointer) {
            return None;
        }

        if !text.is_empty() {
            parts.push(TextPart::Text(PlainTextPart {
                text: std::mem::take(&mut text),
            }));
        }

        parts.push(TextPart::Slot(SlotTextPart {
            slot: Slot::new(slot.name.to_owned()),
            path: path_of(slot.path),
        }));
        rest = slot.remaining;
    }

    if !text.is_empty() {
        parts.push(TextPart::Text(PlainTextPart { text }));
    }

    Some(parts)
}

fn object_template(
    reading: &mut Reading<'_, '_>,
    value: &JsonObject,
    pointer: &str,
) -> Option<Template> {
    if value.contains_key(EACH_KEY) || value.contains_key(AS_KEY) {
        return each_template(reading, value, pointer);
    }

    let mut members = Vec::new();
    let mut merge: Option<String> = None;

    for (key, member) in js_key_order(value.iter()) {
        let member_pointer = pointer_below(pointer, key);

        if key == MERGE_KEY {
            merge = slot_name(reading, Some(member), &member_pointer, SlotKey::Merge);

            continue;
        }

        let name = member_name(reading, key, &member_pointer);
        let template = template_of(reading, member, &member_pointer);

        if let (Some(name), Some(template)) = (name, template) {
            members.push(ObjectTemplateMember {
                name,
                value: template,
            });
        }
    }

    Some(Template::Object(ObjectTemplate {
        members,
        merge: merge.map(Slot::new),
    }))
}

fn pointer_below(pointer: &str, key: &str) -> String {
    format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"))
}

fn member_name(reading: &mut Reading<'_, '_>, key: &str, pointer: &str) -> Option<MemberName> {
    if let Some(literal) = key.strip_prefix('$').filter(|_| key.starts_with("$$")) {
        return Some(MemberName::Text(PlainMemberName {
            text: literal.to_owned(),
        }));
    }

    if !key.starts_with('$') {
        return Some(MemberName::Text(PlainMemberName {
            text: key.to_owned(),
        }));
    }

    let Some(slot) = name_slot(key) else {
        return refuse_syntax(
            reading,
            pointer,
            &format!(
                "the member name {} is no slot (write $$ for a literal $)",
                quote_text(key)
            ),
        );
    };

    if check_slot(reading, slot, pointer) && check_stand(reading, slot, pointer, SlotStand::Name) {
        return Some(MemberName::Slot(SlotMemberName {
            slot: Slot::new(slot.to_owned()),
        }));
    }

    None
}

fn each_template(
    reading: &mut Reading<'_, '_>,
    value: &JsonObject,
    pointer: &str,
) -> Option<Template> {
    let (Some(each_value), Some(as_value), 2) =
        (value.get(EACH_KEY), value.get(AS_KEY), value.len())
    else {
        return refuse_syntax(
            reading,
            pointer,
            &format!("an array template is {{ {EACH_KEY}, {AS_KEY} }} and nothing else"),
        );
    };

    let of = slot_name(
        reading,
        Some(each_value),
        &pointer_below(pointer, EACH_KEY),
        SlotKey::Each,
    );
    let mut inner = Reading {
        site: &mut *reading.site,
        in_each: true,
        faults: 0,
    };
    let each_as = template_of(&mut inner, as_value, &pointer_below(pointer, AS_KEY));
    let inner_faults = inner.faults;

    reading.faults += inner_faults;

    Some(Template::Each(EachTemplate {
        of: Slot::new(of?),
        r#as: Box::new(each_as?),
    }))
}

// `$merge` and `$each` take a whole slot without a member path.
fn slot_name(
    reading: &mut Reading<'_, '_>,
    value: Option<&JsonValue>,
    pointer: &str,
    key: SlotKey,
) -> Option<String> {
    let slot = match value {
        Some(JsonValue::String(text)) => name_slot(text),
        _ => None,
    };
    let Some(slot) = slot else {
        let example = reading.site.example_slot;

        return refuse_syntax(
            reading,
            pointer,
            &format!(
                "{} takes one slot ({example}), without a member path",
                key.key()
            ),
        );
    };

    (check_slot(reading, slot, pointer) && check_stand(reading, slot, pointer, key.stand()))
        .then(|| slot.to_owned())
}
