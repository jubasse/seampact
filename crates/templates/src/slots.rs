//! The slots a read template writes.

use seampact_diagnostics::InternalError;
use seampact_ir::{MemberName, Template, TextPart};

use crate::site::TemplateSlotUse;

fn unknown_kind(what: &str, kind: &str) -> InternalError {
    InternalError::new(format!(
        "the template holds a {what} of kind {kind}, which this compiler does not know"
    ))
}

fn text_part_slots(parts: &[TextPart]) -> Result<Vec<TemplateSlotUse>, InternalError> {
    let mut used = Vec::new();

    for part in parts {
        match part {
            TextPart::Slot(slot) => used.push(TemplateSlotUse {
                slot: slot.slot.as_str().to_owned(),
                path: slot.path.clone(),
            }),
            TextPart::Text(_) => {}
            TextPart::Unknown(kind) => return Err(unknown_kind("text part", kind.tag())),
        }
    }

    Ok(used)
}

fn whole_slot(slot: &str) -> TemplateSlotUse {
    TemplateSlotUse {
        slot: slot.to_owned(),
        path: Vec::new(),
    }
}

/// Every slot a template writes: whole slots, text parts, member names, the merged slot and each
/// array slot.
///
/// # Errors
///
/// An [`InternalError`] for a template, member name or text part of a kind this compiler does not
/// know: the reader never builds one.
pub fn template_slots(template: &Template) -> Result<Vec<TemplateSlotUse>, InternalError> {
    match template {
        Template::Slot(slot) => Ok(vec![TemplateSlotUse {
            slot: slot.slot.as_str().to_owned(),
            path: slot.path.clone(),
        }]),
        Template::Text(text) => text_part_slots(&text.parts),
        Template::Literal(_) => Ok(Vec::new()),
        Template::Object(object) => {
            let mut used = Vec::new();

            if let Some(merge) = &object.merge {
                used.push(whole_slot(merge.as_str()));
            }

            for member in &object.members {
                match &member.name {
                    MemberName::Slot(slot) => used.push(whole_slot(slot.slot.as_str())),
                    MemberName::Text(_) => {}
                    MemberName::Unknown(kind) => {
                        return Err(unknown_kind("member name", kind.tag()));
                    }
                }

                used.extend(template_slots(&member.value)?);
            }

            Ok(used)
        }
        Template::Array(array) => {
            let mut used = Vec::new();

            for item in &array.items {
                used.extend(template_slots(item)?);
            }

            Ok(used)
        }
        Template::Each(each) => {
            let mut used = vec![whole_slot(each.of.as_str())];

            used.extend(template_slots(&each.r#as)?);

            Ok(used)
        }
        Template::Unknown(kind) => Err(unknown_kind("template", kind.tag())),
    }
}

/// Whether a template writes `slot` anywhere.
///
/// # Errors
///
/// An [`InternalError`] as [`template_slots`].
pub fn template_uses(template: &Template, slot: &str) -> Result<bool, InternalError> {
    Ok(template_slots(template)?
        .iter()
        .any(|used| used.slot == slot))
}
