//! Bounds on what one load reads and builds, so a hostile or broken contract fails with a located
//! diagnostic instead of exhausting time, memory or the stack.
//!
//! Each is generous for a hand-written contract: the worked example of ADR 0002 is about two
//! thousand nodes and a dozen levels deep. The work and text limits are charged through the load's
//! one budget ([`LoadBudget`](crate::LoadBudget)).

/// Bytes in one file; a larger file is refused unread (`seampact/load/file-too-large`).
pub const LOAD_MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Levels of nesting, counted through `$include` and `$file`, and files in one chain of
/// `$include`, `$file` or pack `extends` (`seampact/load/too-deep`).
pub const LOAD_MAX_DEPTH: usize = 256;

/// Units of work one load may do, every api together (`seampact/load/expansion-limit`): a node
/// built, an `$include` target or `$file` site, a node merged into an api, a leaf origin or a
/// location written. A pointer or key longer than 256 characters costs one more unit per 256.
pub const LOAD_MAX_WORK: u64 = 2_000_000;

/// Characters (UTF-16 code units) of the strings one load admits, keys included, counted for each
/// use of a file and each api a string reaches (`seampact/load/expansion-limit`).
pub const LOAD_MAX_TEXT: u64 = 64 * 1024 * 1024;
