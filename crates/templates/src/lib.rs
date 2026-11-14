//! The template language of ADR 0002 section 13: a raw template read into the IR's `Template`.
//!
//! The caller owns the place: the slots it fills, with their kinds, and the reporter that turns
//! each fault into its own diagnostic. [`template_read`] reads, [`template_slots`] and
//! [`template_uses`] tell which slots a read template writes.

mod checks;
mod reader;
mod site;
mod slot_syntax;
mod slots;

pub use reader::template_read;
pub use site::{
    TemplateFault, TemplateRule, TemplateSite, TemplateSlot, TemplateSlotKind, TemplateSlotUse,
};
pub use slots::{template_slots, template_uses};
