//! The writer's public API against a real directory: paths, manifest, finishing and writes.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod check_generated_paths;
mod file_presence;
mod finish_files;
mod generated_write;
mod manifest;
mod support;
