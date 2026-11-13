//! The optional count members of the draft, read as the IR reads them.

use seampact_json::{MAX_SAFE_INTEGER, optional_js_integer};
use serde::Deserializer;

/// An optional integer from 0 to 2^53 - 1: a size, a limit or a duration.
pub(crate) fn optional_count<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, 0, MAX_SAFE_INTEGER>(deserializer)
}
