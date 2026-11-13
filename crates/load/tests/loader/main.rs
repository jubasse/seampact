//! The loader entry end to end: the fixtures, the workspace and api flow, packs, the hardening
//! cases and the edge values of the JavaScript differences the loader touches.

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

mod compose;
mod fixtures;
mod hardening;
mod harness;
mod packs;
mod section_two;
mod workspace;
