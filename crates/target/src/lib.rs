//! What the document emitter, the CLI and the generator planning share from `codegen-core`.
//!
//! A target that produces no file answers [`Refusal`]s, each located by an [`IrLocation`] and
//! built by [`refuse_not_generated_yet`], [`refuse_unknown_value_at`] or [`refuse_inconsistent_ir`];
//! [`case_folded`] folds a path for the case-insensitive comparisons of config roots and the writer.

mod case_folded;
mod ir_location;
mod located_refusals;
mod not_generated_fixes;
mod refusal;
mod unknown_value;

pub use case_folded::case_folded;
pub use ir_location::IrLocation;
pub use located_refusals::{
    refuse_inconsistent_ir, refuse_not_generated_yet, refuse_unknown_value_at,
};
pub use not_generated_fixes::{
    GENERATE_TROUBLESHOOTING_URL, GenerateTroubleshootingSection, LINK_TROUBLESHOOTING_URL,
    NotGeneratedForm, troubleshooting_url,
};
pub use refusal::{Refusal, without_repeats};
pub use unknown_value::refuse_unknown_value;
