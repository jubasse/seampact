//! The IR version and revision this crate reads and writes (ADR 0005 section 2).

/// `irVersion`: 1 until 1.0 and through 1.x.
pub const IR_VERSION: i64 = 1;

/// `irRevision`: rises by one with every IR change PR (`schemas/ir/CHANGE-TEMPLATE.md`).
pub const IR_REVISION: i64 = 6;

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript source of the version, the one the IR schemas move with.
    const TYPESCRIPT_VERSION: &str = include_str!("../../../packages/core/spec/src/ir/version.ts");

    #[test]
    fn the_version_and_revision_match_the_typescript_ones() {
        assert!(TYPESCRIPT_VERSION.contains(&format!("export const IR_VERSION = {IR_VERSION};")));
        assert!(TYPESCRIPT_VERSION.contains(&format!("export const IR_REVISION = {IR_REVISION};")));
    }
}
