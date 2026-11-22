//! The templates of a wire format and the schemas of the slots they write.

use indexmap::IndexMap;
use seampact_ir::{
    Absent, EachTemplate, KnownTemplateRef, KnownTextPartRef, MemberName, ObjectTemplate, Template,
    TextTemplate,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::OpenApiError;
use crate::emit_context::{EmitContext, refuse_not_emitted, refuse_unknown};
use crate::schemas::nullable_schema;

/// The names `Object.prototype` carries, which the `in` operator finds on any plain object.
const OBJECT_PROTOTYPE_NAMES: [&str; 12] = [
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
];

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
        KnownTemplateRef::Text(text) => Ok(Some(text_template_schema(text, slots))),
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
///
/// # Errors
///
/// As the writer of an object template.
pub(crate) fn render_template(
    context: &mut EmitContext<'_>,
    template: &Template,
    values: &IndexMap<String, JsonValue>,
    location: &IrLocation,
) -> Result<Option<JsonValue>, OpenApiError> {
    let Ok(known) = KnownTemplateRef::try_from(template) else {
        refuse_unknown(context, &location.below(&["kind"]), template.tag());

        return Ok(None);
    };

    match known {
        KnownTemplateRef::Slot(slot) => {
            let value = if slot.path.is_empty() {
                values.get(slot.slot.as_str()).cloned()
            } else {
                None
            };

            if value.is_none() {
                refuse_not_emitted(
                    context,
                    NotGeneratedForm::OpenapiExampleSlot,
                    &format!("An example through the slot '${}'", slot.slot),
                    location,
                );
            }

            Ok(value)
        }
        KnownTemplateRef::Literal(literal) => Ok(Some(literal.value.clone())),
        KnownTemplateRef::Object(object) => {
            render_object_template(context, object, values, location)
        }
        KnownTemplateRef::Text(_) | KnownTemplateRef::Each(_) | KnownTemplateRef::Array(_) => {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleTemplate,
                &format!("An example through a '{}' template", template.tag()),
                location,
            );

            Ok(None)
        }
    }
}

/// The object an object template writes; a merging template and a slot-named member are refused.
fn render_object_template(
    context: &mut EmitContext<'_>,
    template: &ObjectTemplate,
    values: &IndexMap<String, JsonValue>,
    location: &IrLocation,
) -> Result<Option<JsonValue>, OpenApiError> {
    if template.merge.is_some() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiExampleMerge,
            "An example through a merging template",
            location,
        );

        return Ok(None);
    }

    let mut rendered = JsonObject::new();

    for (index, member) in template.members.iter().enumerate() {
        let MemberName::Text(name) = &member.name else {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiExampleMemberName,
                "An example through a member named by a slot",
                location,
            );

            continue;
        };
        let value_location = location.below(&["members", &index.to_string(), "value"]);
        let value = render_template(context, &member.value, values, &value_location)?;

        if let Some(written) = value {
            rendered.insert(name.text.clone(), written);
        }
    }

    Ok(Some(JsonValue::Object(rendered)))
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

/// The schema of a text template: a constant when every part is one, else a string.
fn text_template_schema(template: &TextTemplate, slots: &SlotSchemas) -> SlotValue {
    let schema = match constant_text(template, slots) {
        Some(constant) => JsonObject::from_members([("const", JsonValue::text(&constant))]),
        None => JsonObject::from_members([("type", JsonValue::text("string"))]),
    };

    SlotValue::always(schema)
}

/// The text a template always writes, or `None` when a part is not a known constant.
fn constant_text(template: &TextTemplate, slots: &SlotSchemas) -> Option<String> {
    let mut text = String::new();

    for part in &template.parts {
        match KnownTextPartRef::try_from(part).ok()? {
            KnownTextPartRef::Text(plain) => text.push_str(&plain.text),
            KnownTextPartRef::Slot(slot) => {
                let value = slots
                    .get(slot.slot.as_str())
                    .filter(|_| slot.path.is_empty())?;

                if value.presence != SlotPresence::Always {
                    return None;
                }

                let Some(JsonValue::String(constant)) = value.schema.get("const") else {
                    return None;
                };

                text.push_str(constant);
            }
        }
    }

    Some(text)
}

/// Whether `name` is a key of a fresh JavaScript object holding `properties`: its own members and
/// the names `Object.prototype` carries.
fn is_in_plain_object(properties: &JsonObject, name: &str) -> bool {
    properties.contains_key(name) || OBJECT_PROTOTYPE_NAMES.contains(&name)
}

/// The schema of an object template: its members, the `merge` slot folded in with `allOf`.
fn object_template_schema(
    context: &mut EmitContext<'_>,
    template: &ObjectTemplate,
    slots: &SlotSchemas,
    absent: &Absent,
    location: &IrLocation,
) -> Result<Option<SlotValue>, OpenApiError> {
    let mut properties = JsonObject::new();
    let mut required: Vec<JsonValue> = Vec::new();
    let mut presence = if template.members.is_empty() {
        SlotPresence::Always
    } else {
        SlotPresence::Maybe
    };

    for (index, member) in template.members.iter().enumerate() {
        let member_location = location.below(&["members", &index.to_string()]);
        let Some(member_name) = member_name_of(
            context,
            &member.name,
            slots,
            &member_location.below(&["name"]),
        ) else {
            continue;
        };

        if is_in_plain_object(&properties, &member_name) {
            refuse_not_emitted(
                context,
                NotGeneratedForm::OpenapiTemplateMemberRepeated,
                &format!("The member '{member_name}' written twice in one object"),
                &member_location.below(&["name"]),
            );

            continue;
        }

        let Some(value) = template_schema(
            context,
            &member.value,
            slots,
            absent,
            &member_location.below(&["value"]),
        )?
        else {
            continue;
        };

        if value.presence == SlotPresence::Never {
            if *absent == Absent::Null {
                properties.insert(
                    member_name.clone(),
                    JsonValue::Object(JsonObject::from_members([(
                        "type",
                        JsonValue::text("null"),
                    )])),
                );
                required.push(JsonValue::text(&member_name));
            }

            continue;
        }

        if value.presence == SlotPresence::Always {
            presence = SlotPresence::Always;
        }

        let null_when_absent = value.presence == SlotPresence::Maybe && *absent == Absent::Null;
        let member_schema = if null_when_absent {
            nullable_schema(value.schema)
        } else {
            value.schema
        };

        properties.insert(member_name.clone(), JsonValue::Object(member_schema));

        if value.presence == SlotPresence::Always || null_when_absent {
            required.push(JsonValue::text(&member_name));
        }
    }

    let mut schema = JsonObject::from_members([
        ("type", JsonValue::text("object")),
        ("properties", JsonValue::Object(properties)),
    ]);

    if !required.is_empty() {
        schema.insert("required".to_owned(), JsonValue::Array(required));
    }

    Ok(Some(merge_object_schema(
        context, template, schema, presence, slots, location,
    )))
}

/// The object schema with the template's `merge` slot folded in under `allOf`.
fn merge_object_schema(
    context: &mut EmitContext<'_>,
    template: &ObjectTemplate,
    schema: JsonObject,
    presence: SlotPresence,
    slots: &SlotSchemas,
    location: &IrLocation,
) -> SlotValue {
    let Some(merge) = &template.merge else {
        return SlotValue {
            schema,
            presence,
            element: None,
        };
    };
    let merged = slot_schema(
        context,
        merge.as_str(),
        &[],
        slots,
        &location.below(&["merge"]),
    );

    match merged {
        Some(merged) if merged.presence != SlotPresence::Never => {
            let all_of = JsonValue::Array(vec![
                JsonValue::Object(schema),
                JsonValue::Object(merged.schema),
            ]);
            let merged_presence = if merged.presence == SlotPresence::Always {
                SlotPresence::Always
            } else {
                presence
            };

            SlotValue {
                schema: JsonObject::from_members([("allOf", all_of)]),
                presence: merged_presence,
                element: None,
            }
        }
        Some(_) | None => SlotValue {
            schema,
            presence,
            element: None,
        },
    }
}

/// The array schema of `$each`: the schema of `$as` over the elements of the array slot.
fn each_schema(
    context: &mut EmitContext<'_>,
    template: &EachTemplate,
    slots: &SlotSchemas,
    absent: &Absent,
    location: &IrLocation,
) -> Result<Option<SlotValue>, OpenApiError> {
    let of_location = location.below(&["of"]);
    let Some(array) = slot_schema(context, template.of.as_str(), &[], slots, &of_location) else {
        return Ok(None);
    };
    let Some(element) = &array.element else {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiTemplateEach,
            &format!(
                "The slot '${}' read by '$each' in this place",
                template.of.as_str()
            ),
            &of_location,
        );

        return Ok(None);
    };
    let as_location = location.below(&["as"]);
    let rendered = template_schema(context, &template.r#as, element, absent, &as_location)?;
    let Some(item) = rendered else {
        return Ok(None);
    };

    if item.presence == SlotPresence::Never {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiTemplateEach,
            "A '$each' whose '$as' is never written",
            &as_location,
        );

        return Ok(None);
    }

    let array_schema = JsonObject::from_members([
        ("type", JsonValue::text("array")),
        ("items", JsonValue::Object(item.schema)),
    ]);

    Ok(Some(SlotValue::always(array_schema)))
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

#[cfg(test)]
mod tests {
    use crate::EmitterOptions;
    use crate::emit_context::{create_emit_context, fixture_ir};

    use super::*;

    fn object_template(names: &[&str]) -> Result<ObjectTemplate, serde_json::Error> {
        let members: Vec<serde_json::Value> = names
            .iter()
            .map(|name| {
                serde_json::json!({
                    "name": {"kind": "text", "text": name},
                    "value": {"kind": "literal", "value": 1},
                })
            })
            .collect();

        serde_json::from_value(serde_json::json!({"kind": "object", "members": members}))
    }

    #[test]
    fn object_members_follow_javascript_key_order() -> Result<(), Box<dyn std::error::Error>> {
        let ir = fixture_ir()?;
        let options = EmitterOptions::default();
        let mut context = create_emit_context(&ir, &options);
        let template = object_template(&["b", "10", "2", "a"])?;
        let location = IrLocation::root();
        let value = object_template_schema(
            &mut context,
            &template,
            &SlotSchemas::new(),
            &Absent::Omit,
            &location,
        )?
        .ok_or("refused")?;
        let Some(JsonValue::Object(properties)) = value.schema.get("properties") else {
            return Err("no properties".into());
        };
        let names: Vec<&str> = properties.keys().map(String::as_str).collect();

        assert_eq!(names, ["2", "10", "b", "a"]);

        Ok(())
    }

    #[test]
    fn a_member_named_like_an_object_prototype_key_is_refused_as_repeated()
    -> Result<(), Box<dyn std::error::Error>> {
        let ir = fixture_ir()?;
        let options = EmitterOptions::default();
        let mut context = create_emit_context(&ir, &options);
        let location = IrLocation::root();

        for name in ["constructor", "toString", "__proto__"] {
            let template = object_template(&[name])?;
            let value = object_template_schema(
                &mut context,
                &template,
                &SlotSchemas::new(),
                &Absent::Omit,
                &location,
            )?
            .ok_or("refused")?;

            assert_eq!(
                value.schema.get("properties"),
                Some(&JsonValue::Object(JsonObject::new())),
                "member {name:?}"
            );
        }

        assert_eq!(context.refusals.len(), 3);

        Ok(())
    }
}
