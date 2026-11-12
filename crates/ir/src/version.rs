//! The IR version and revision this crate reads and writes (ADR 0005 section 2).

/// `irVersion`: 1 until 1.0 and through 1.x.
pub const IR_VERSION: i64 = 1;

/// `irRevision`: rises by one with every IR change PR (`schemas/ir/CHANGE-TEMPLATE.md`).
pub const IR_REVISION: i64 = 6;
