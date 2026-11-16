//! JavaScript semantics shared by every crate of the Rust port.
//!
//! Each module reproduces one JavaScript behaviour that Rust does differently:
//! [`cmp_utf16`] and [`Utf16Key`] order strings by UTF-16 code units as `<` and
//! `.sort()` do, and [`js_key_order`] and [`reorder_in_js_key_order`] give the key
//! order of `Object.keys` and `JSON.stringify`, and [`FiniteNumber`] writes a number as
//! `String(n)` and `JSON.stringify(n)` do, [`js_number_of_text`] reads a string as `Number(text)`
//! does, [`is_ecmascript_white_space`] is the `\s` class, [`utf16_prefix`] is
//! `text.slice(0, units)`, [`regexp_source`] is `RegExp.prototype.source`, and
//! [`json_parse_error_message`] is what `JSON.parse` throws for a text it refuses.
//!
//! Review rule: map indexing (`map[&key]`) panics on a missing key and has no clippy
//! lint; use `.get(&key)` and handle the absence.

mod json_parse_message;
mod key_order;
mod list_index;
mod number_text;
mod regexp_source;
mod string_to_number;
mod utf16_order;
mod utf16_prefix;
mod white_space;

pub use json_parse_message::json_parse_error_message;
pub use key_order::{
    InsertionOrderedMap, MAX_ARRAY_INDEX, array_index_value, js_key_order, reorder_in_js_key_order,
};
pub use list_index::list_index_of_number_text;
pub use number_text::FiniteNumber;
pub use regexp_source::regexp_source;
pub use string_to_number::js_number_of_text;
pub use utf16_order::{Utf16Key, cmp_utf16};
pub use utf16_prefix::utf16_prefix;
pub use white_space::is_ecmascript_white_space;
