//! JavaScript semantics shared by every crate of the Rust port.
//!
//! Each module reproduces one JavaScript behaviour that Rust does differently:
//! [`cmp_utf16`] and [`Utf16Key`] order strings by UTF-16 code units as `<` and
//! `.sort()` do, and [`js_key_order`] and [`reorder_in_js_key_order`] give the key
//! order of `Object.keys` and `JSON.stringify`.
//!
//! Review rule: map indexing (`map[&key]`) panics on a missing key and has no clippy
//! lint; use `.get(&key)` and handle the absence.

mod key_order;
mod utf16_order;

pub use key_order::{MAX_ARRAY_INDEX, is_array_index, js_key_order, reorder_in_js_key_order};
pub use utf16_order::{Utf16Key, cmp_utf16};
