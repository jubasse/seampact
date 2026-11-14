//! The `tree.nodes` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/tree/nodes`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod api;
mod collections;
mod degradable;
mod diagnostics;
mod examples;
mod field_wire;
mod fields;
mod formats;
mod input;
mod lifecycle;
mod limits;
mod not_ported;
mod operations;
mod paging;
mod pagings;
mod params;
mod pass;
mod paths;
mod relays;
mod responses;
mod settings;
mod templates;
mod writes;

pub use diagnostics::RULE_IDS;
pub use field_wire::tree_nodes_field_wire;
pub use limits::{TreeNodesBodyLimit, TreeNodesBodyLimitContext, tree_nodes_body_limit};
pub use pass::run;
