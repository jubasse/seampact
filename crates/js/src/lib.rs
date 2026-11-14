//! JavaScript semantics shared by every crate of the Rust port.
//!
//! Each module reproduces one JavaScript behaviour that Rust does differently:
//! [`cmp_utf16`] and [`Utf16Key`] order strings by UTF-16 code units as `<` and
//! `.sort()` do, and [`js_key_order`] and [`reorder_in_js_key_order`] give the key
//! order of `Object.keys` and `JSON.stringify`, and [`FiniteNumber`] writes a number as
//! `String(n)` and `JSON.stringify(n)` do, and [`is_ecmascript_white_space`] is the `\s` class.
//!
//! Review rule: map indexing (`map[&key]`) panics on a missing key and has no clippy
//! lint; use `.get(&key)` and handle the absence.

mod key_order;
mod list_index;
mod number_text;
mod utf16_order;
mod white_space;

pub use key_order::{
    InsertionOrderedMap, MAX_ARRAY_INDEX, array_index_value, js_key_order, reorder_in_js_key_order,
};
pub use list_index::list_index_of_number_text;
pub use number_text::FiniteNumber;
pub use utf16_order::{Utf16Key, cmp_utf16};
pub use white_space::is_ecmascript_white_space;
