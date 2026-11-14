//! The place a template is read in: its slots, its names in messages and its reporter.

/// What a slot holds, which sets where it may stand.
///
/// `$merge` takes an object, `$each` an array, and a `$` key a name. `Payload` holds an
/// operation's payload, which may be either and is checked per operation by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateSlotKind {
    /// An object.
    Object,
    /// An array.
    Array,
    /// A member name.
    Name,
    /// Any value.
    Value,
    /// A flag.
    Flag,
    /// An operation's payload.
    Payload,
}

/// A slot a place fills.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateSlot {
    /// The slot name, written `$name`.
    pub name: String,
    /// What the slot holds.
    pub kind: TemplateSlotKind,
}

/// The faults of a template, one rule each; the caller maps them to its own rule ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateRule {
    /// A slot the place does not fill.
    Slot,
    /// A `$` that starts no slot, or a malformed `$each`.
    Syntax,
    /// A `$merge` of a slot that holds no object.
    Merge,
    /// A `$each` of a slot that holds no array.
    Each,
    /// A member name slot that holds no name.
    Name,
}

impl TemplateRule {
    /// The rule as the fault names it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Slot => "template-slot",
            Self::Syntax => "template-syntax",
            Self::Merge => "template-merge",
            Self::Each => "template-each",
            Self::Name => "template-name",
        }
    }
}

/// One fault, at the raw pointer it is written at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateFault {
    /// The rule of the fault.
    pub rule: TemplateRule,
    /// The raw pointer the fault is written at.
    pub pointer: String,
    /// What is wrong.
    pub message: String,
    /// How to fix it.
    pub fix: String,
}

/// Where a template is read: the slots of its place, its owner and placement as messages name
/// them, and its reporter.
pub struct TemplateSite<'caller> {
    /// The slots the place fills.
    pub slots: &'caller [TemplateSlot],
    /// The slots `$as` adds: the element of the array slot and what is read from it.
    pub each_slots: &'caller [TemplateSlot],
    /// The owner, as messages name it: `the format acmeEnvelope`, `the paging style cursor`.
    pub owner: &'caller str,
    /// The place, as messages name it: `success.item`, `an error body`.
    pub place_name: &'caller str,
    /// The slot messages give as the example of a whole slot: `$payload`.
    pub example_slot: &'caller str,
    /// The ADR sections messages cite for the slots of the place: `ADR 0002 sections 13 and 14`.
    pub adr_sections: &'caller str,
    /// Receives each fault as it is found.
    pub report: &'caller mut dyn FnMut(TemplateFault),
}

/// A slot a template writes, with the member path read from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateSlotUse {
    /// The slot name.
    pub slot: String,
    /// The member path read from the slot.
    pub path: Vec<String>,
}
