//! The cross-member rules of the IR that the schema subset cannot state, by stable id.
//!
//! [`check_ir_invariants`] runs them on an IR document read as JSON: a rule decided by an open-enum
//! value applies to known values only, and an unknown tag or value is the reader's to name.

mod catalogue_refs;
mod decode;
mod deprecation;
mod document;
mod error_declarations;
mod exact_numbers;
mod input_proofs;
mod json_members;
mod object_rules;
mod open_values;
mod operation;
mod partitions;
mod right_subjects;
mod violation;

pub use document::check_ir_invariants;
pub use partitions::IR_PARTITIONS;
pub use violation::{IrInvariantId, IrInvariantViolation};
