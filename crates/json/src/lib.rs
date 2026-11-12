//! JSON values as JavaScript holds them, and their canonical text.
//!
//! [`JsonValue`] is the opaque value of the IR and of the authoring tree; its numbers are
//! [`JsonNumber`]s, its objects [`JsonObject`]s that keep JavaScript's own-key order.
//! [`canonical_document`] writes the IR and source-map bytes, [`canonical_json`] the compact key
//! of a value. [`js_integer`] reads an IR integer member with JavaScript semantics, [`present`]
//! an optional opaque member that keeps a present `null`, and [`escape_pointer`] escapes a JSON
//! Pointer segment.

mod canonical;
mod error;
mod js_integer;
mod number;
mod object;
mod pointer;
mod value;

pub use canonical::{canonical_document, canonical_json, write_json_string};
pub use error::JsonError;
pub use js_integer::{
    MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, js_integer, js_integer_in_range, optional_js_integer,
};
pub use number::JsonNumber;
pub use object::JsonObject;
pub use pointer::escape_pointer;
pub use value::{JsonValue, present};
