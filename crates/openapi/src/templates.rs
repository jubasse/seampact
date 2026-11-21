//! The templates of a wire format and the schemas of the slots they write.

use indexmap::IndexMap;
use seampact_ir::{MemberName, Template};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::emit_context::{EmitContext, refuse_not_emitted};

/// Whether a slot always has a value, may have none, or never has one here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SlotPresence {
    /// Always a value.
    Always,
    /// Maybe a value.
    Maybe,
    /// Never a value: omitted, or `null` under `absent: null`.
    Never,
}

/// The schema of a slot, whether it is present, and for an array slot the slots inside `$each`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SlotValue {
    /// The schema of the slot's value.
    pub(crate) schema: JsonObject,
    /// Whether the slot has a value.
    pub(crate) presence: SlotPresence,
    /// The slots visible inside `$each` over an array slot.
    pub(crate) element: Option<SlotSchemas>,
}

/// The slots a template can read, by name.
pub(crate) type SlotSchemas = IndexMap<String, SlotValue>;

/// The names of the members of an object template that write `slot` whole.
pub(crate) fn members_writing_slot<'template>(
    template: &'template Template,
    slot: &str,
) -> Vec<&'template str> {
    let Template::Object(object) = template else {
        return Vec::new();
    };

    object
        .members
        .iter()
        .filter_map(|member| {
            let Template::Slot(value) = &member.value else {
                return None;
            };
            let writes_slot = value.slot.as_str() == slot && value.path.is_empty();

            match &member.name {
                MemberName::Text(name) if writes_slot => Some(name.text.as_str()),
                MemberName::Text(_) | MemberName::Slot(_) | MemberName::Unknown(_) => None,
            }
        })
        .collect()
}

/// The text a member name writes: its own, or the constant of the slot that names it.
fn member_name_of(
    context: &mut EmitContext<'_>,
    name: &MemberName,
    slots: &SlotSchemas,
    location: &IrLocation,
) -> Option<String> {
    let slot_name = match name {
        MemberName::Text(plain) => return Some(plain.text.clone()),
        MemberName::Slot(slot) => Some(slot.slot.as_str()),
        MemberName::Unknown(_) => None,
    };
    let constant = slot_name
        .and_then(|slot| slots.get(slot))
        .and_then(|value| value.schema.get("const"));

    if let Some(JsonValue::String(text)) = constant {
        return Some(text.clone());
    }

    refuse_not_emitted(
        context,
        NotGeneratedForm::OpenapiTemplateMemberName,
        "A member named by a slot",
        location,
    );

    None
}
