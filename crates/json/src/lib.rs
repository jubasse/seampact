//! JSON values as JavaScript holds them, and their canonical text.
//!
//! [`JsonValue`] is the opaque value of the IR and of the authoring tree; its numbers are
//! [`JsonNumber`]s, its objects [`JsonObject`]s that keep JavaScript's own-key order.
//! [`canonical_document`] writes the IR and source-map bytes, [`canonical_json`] the compact key
//! of a value, [`indented_json`] the `JSON.stringify(value, null, 2)` text. [`js_integer`] reads an IR integer member with JavaScript semantics, [`present`]
//! an optional opaque member that keeps a present `null`, [`escape_pointer`] escapes a JSON
//! Pointer segment, [`pointer_below`] extends a pointer and [`json_at_pointer`] reads the value a
//! pointer names. [`object_of`], [`items_of`], [`text_of`] and [`is_text`] read an optional value
//! by its kind, and `JsonObject`'s `object_member`, `array_member` and `text_member` read a member. [`js_text_of`] is `String(value)`.
//! [`from_json_value`] reads a value into any serde type, naming the pointer of what failed.

mod access;
mod canonical;
mod error;
mod from_json_value;
mod js_integer;
mod js_text;
mod json_read_error;
mod number;
mod object;
mod pointer;
mod value;

pub use access::{is_text, items_of, object_of, text_of};
pub use canonical::{
    canonical_document, canonical_json, indented_json, stringify_json, write_json_string,
};
pub use error::JsonError;
pub use from_json_value::from_json_value;
pub use js_integer::{
    MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, js_integer, js_integer_in_range, optional_js_integer,
};
pub use js_text::js_text_of;
pub use json_read_error::{JsonReadError, JsonReadKind};
pub use number::JsonNumber;
pub use object::JsonObject;
pub use pointer::{
    escape_pointer, json_at, json_at_object, json_at_pointer, pointer_below, pointer_segments,
};
pub use value::{JsonValue, present};
