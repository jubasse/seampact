//! The templates of a wire format and the schemas of the slots they write.

use indexmap::IndexMap;
use seampact_ir::{
    Absent, EachTemplate, KnownTemplateRef, MemberName, ObjectTemplate, Template, TextTemplate,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::OpenApiError;
use crate::emit_context::{EmitContext, refuse_not_emitted, refuse_unknown};
use crate::not_ported::not_ported_yet;

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

impl SlotValue {
    /// A slot that always has `schema` as its value.
    pub(crate) fn always(schema: JsonObject) -> Self {
        Self::with_presence(schema, SlotPresence::Always)
    }

    /// A slot that may have `schema` as its value.
    pub(crate) fn maybe(schema: JsonObject) -> Self {
        Self::with_presence(schema, SlotPresence::Maybe)
    }

    /// A slot with no value here.
    pub(crate) fn never_sent() -> Self {
        Self::with_presence(JsonObject::new(), SlotPresence::Never)
    }

    fn with_presence(schema: JsonObject, presence: SlotPresence) -> Self {
        Self {
            schema,
            presence,
            element: None,
        }
    }
}

/// The slots a template can read, by name.
pub(crate) type SlotSchemas = IndexMap<String, SlotValue>;

/// The schema of a template over the slots it reads, or `None` when a part is refused.
///
/// # Errors
///
/// As the writers of the kinds it reaches.
pub(crate) fn template_schema(
    context: &mut EmitContext<'_>,
    template: &Template,
    slots: &SlotSchemas,
    absent: &Absent,
    location: &IrLocation,
) -> Result<Option<SlotValue>, OpenApiError> {
    let Ok(known) = KnownTemplateRef::try_from(template) else {
        refuse_unknown(context, &location.below(&["kind"]), template.tag());

        return Ok(None);
    };

    match known {
        KnownTemplateRef::Slot(slot) => Ok(slot_schema(
            context,
            slot.slot.as_str(),
            &slot.path,
            slots,
            location,
        )),
        KnownTemplateRef::Text(text) => text_template_schema(text, slots),
        KnownTemplateRef::Literal(literal) => {
            Ok(Some(SlotValue::always(JsonObject::from_iter([(
                "const".to_owned(),
                literal.value.clone(),
            )]))))
        }
        KnownTemplateRef::Object(object) => {
            object_template_schema(context, object, slots, absent, location)
        }
        KnownTemplateRef::Each(each) => each_schema(context, each, slots, absent, location),
        KnownTemplateRef::Array(_) => {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiTemplateArray,
                "An 'array' template",
                location,
            );

            Ok(None)
        }
    }
}

/// The JSON a template writes with the slot values `values`, or `None` when a part is refused.
pub(crate) fn render_template(
    _context: &mut EmitContext<'_>,
    _template: &Template,
    _values: &IndexMap<String, JsonValue>,
    _location: &IrLocation,
) -> Result<Option<JsonValue>, OpenApiError> {
    Err(not_ported_yet("renderTemplate"))
}

/// The value a slot holds, refusing a member path and a slot the place does not offer.
fn slot_schema(
    context: &mut EmitContext<'_>,
    slot: &str,
    path: &[String],
    slots: &SlotSchemas,
    location: &IrLocation,
) -> Option<SlotValue> {
    if !path.is_empty() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiTemplateSlotPath,
            &format!("The slot member '${slot}.{}'", path.join(".")),
            location,
        );

        return None;
    }

    let value = slots.get(slot).cloned();

    if value.is_none() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiTemplateSlot,
            &format!("The slot '${slot}' in this place"),
            location,
        );
    }

    value
}

fn text_template_schema(
    _template: &TextTemplate,
    _slots: &SlotSchemas,
) -> Result<Option<SlotValue>, OpenApiError> {
    Err(not_ported_yet("textTemplateSchema"))
}

fn object_template_schema(
    _context: &mut EmitContext<'_>,
    _template: &ObjectTemplate,
    _slots: &SlotSchemas,
    _absent: &Absent,
    _location: &IrLocation,
) -> Result<Option<SlotValue>, OpenApiError> {
    Err(not_ported_yet("objectTemplateSchema"))
}

fn each_schema(
    _context: &mut EmitContext<'_>,
    _template: &EachTemplate,
    _slots: &SlotSchemas,
    _absent: &Absent,
    _location: &IrLocation,
) -> Result<Option<SlotValue>, OpenApiError> {
    Err(not_ported_yet("eachSchema"))
}

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
