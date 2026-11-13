//! The expansion of one layer file: `$include`, `$file` and the file form of `$ref`, run on
//! in-memory workspaces through the file store, the reporter, the budget and the positions.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    clippy::format_push_string,
    clippy::format_collect,
    reason = "test code: a failed lookup is the failed test"
)]

mod file_directive;
mod file_reference;
mod harness;
mod include;
mod limits;
mod property;
mod scalar_type;
