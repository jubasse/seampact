//! The pipeline readers over a loaded tree: pointers and origins, units, the tree nodes and the
//! inherited settings, the conventions and the declared catalogue entries.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    reason = "test code: a failed lookup is the failed test"
)]

mod context;
mod conventions;
mod declared;
mod inherited;
mod pointer;
mod raw_api;
mod units;
