//! The checks a reading makes while it reads: a slot the place fills, and a slot of the kind
//! its stand needs; each fault is reported to the caller and counted.

use seampact_diagnostics::quote_text;

use crate::site::{TemplateFault, TemplateRule, TemplateSite, TemplateSlot, TemplateSlotKind};

/// One reading of a template: its site, whether it is inside `$as`, and the faults so far.
pub(crate) struct Reading<'site, 'caller> {
    pub(crate) site: &'site mut TemplateSite<'caller>,
    pub(crate) in_each: bool,
    pub(crate) faults: usize,
}

/// Where a slot stands in a template: spread by `$merge`, mapped by `$each`, or naming a member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SlotStand {
    Merge,
    Each,
    Name,
}

struct StandRule {
    rule: TemplateRule,
    kinds: &'static [TemplateSlotKind],
    verb: &'static str,
    need: &'static str,
    fix_lead: &'static str,
    fix_tail: &'static str,
    /// Said after the fix when no slot of the place fits.
    no_fit_hint: &'static str,
}

const fn stand_rule(stand: SlotStand) -> StandRule {
    match stand {
        SlotStand::Merge => StandRule {
            rule: TemplateRule::Merge,
            kinds: &[TemplateSlotKind::Object, TemplateSlotKind::Payload],
            verb: "merges",
            need: "object",
            fix_lead: "Merge an object",
            fix_tail: "write the slot as a member.",
            no_fit_hint: "",
        },
        SlotStand::Each => StandRule {
            rule: TemplateRule::Each,
            kinds: &[TemplateSlotKind::Array, TemplateSlotKind::Payload],
            verb: "maps with $each",
            need: "array",
            fix_lead: "Map an array",
            fix_tail: "write the slot as a member.",
            no_fit_hint: "",
        },
        SlotStand::Name => StandRule {
            rule: TemplateRule::Name,
            kinds: &[TemplateSlotKind::Name],
            verb: "names a member with",
            need: "name",
            fix_lead: "Name the member with a name",
            fix_tail: "write $$ for a literal $.",
            no_fit_hint: " Write $$ for a literal $.",
        },
    }
}

// The slots a reading may write: its place's, and inside `$as` the element's too.
fn readable_slots<'a>(reading: &'a Reading<'_, '_>) -> impl Iterator<Item = &'a TemplateSlot> {
    let element_slots: &[TemplateSlot] = if reading.in_each {
        reading.site.each_slots
    } else {
        &[]
    };

    reading.site.slots.iter().chain(element_slots)
}

fn slot_of<'a>(reading: &'a Reading<'_, '_>, name: &str) -> Option<&'a TemplateSlot> {
    readable_slots(reading).find(|slot| slot.name == name)
}

// ADR 0002 section 13: a slot stands where its kind fits; a `payload` slot is checked per
// operation by the caller.
pub(crate) fn check_stand(
    reading: &mut Reading<'_, '_>,
    slot: &str,
    pointer: &str,
    stand: SlotStand,
) -> bool {
    let rule = stand_rule(stand);
    let kind = slot_of(reading, slot).map_or(TemplateSlotKind::Value, |found| found.kind);

    if rule.kinds.contains(&kind) {
        return true;
    }

    let fitting: Vec<String> = readable_slots(reading)
        .filter(|candidate| rule.kinds.contains(&candidate.kind))
        .map(|candidate| format!("${}", candidate.name))
        .collect();
    let written = quote_text(&format!("${slot}"));
    let site = &*reading.site;
    let fix = if fitting.is_empty() {
        format!(
            "Write {written} as a member: {} fills no slot that holds a {}.{}",
            site.place_name, rule.need, rule.no_fit_hint
        )
    } else {
        format!(
            "{} slot ({}), or {}",
            rule.fix_lead,
            fitting.join(", "),
            rule.fix_tail
        )
    };
    let message = format!(
        "The template of {} {} {written}, which holds no {}.",
        site.owner, rule.verb, rule.need
    );

    reading.faults += 1;
    (reading.site.report)(TemplateFault {
        rule: rule.rule,
        pointer: pointer.to_owned(),
        message,
        fix,
    });

    false
}

pub(crate) fn check_slot(reading: &mut Reading<'_, '_>, slot: &str, pointer: &str) -> bool {
    if slot_of(reading, slot).is_some() {
        return true;
    }

    let site = &*reading.site;
    let message = format!(
        "The template of {} writes the slot {}, which {} does not fill.",
        site.owner,
        quote_text(&format!("${slot}")),
        site.place_name
    );
    let fix = format!(
        "Use a slot of {} ({}), or write {} for the literal text.",
        site.place_name,
        site.adr_sections,
        quote_text(&format!("$${slot}"))
    );

    reading.faults += 1;
    (reading.site.report)(TemplateFault {
        rule: TemplateRule::Slot,
        pointer: pointer.to_owned(),
        message,
        fix,
    });

    false
}

/// Reports a syntax fault and answers `None`, the template that is refused.
pub(crate) fn refuse_syntax<T>(
    reading: &mut Reading<'_, '_>,
    pointer: &str,
    why: &str,
) -> Option<T> {
    let message = format!(
        "The template of {} is not valid: {why}.",
        reading.site.owner
    );

    reading.faults += 1;
    (reading.site.report)(TemplateFault {
        rule: TemplateRule::Syntax,
        pointer: pointer.to_owned(),
        message,
        fix: "Write $name for a slot, ${name} inside a longer text, $$ for a literal $, and { $each: $slot, $as: <template> } for an array.".to_owned(),
    });

    None
}
