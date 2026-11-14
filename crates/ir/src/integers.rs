//! The integer members of the IR, each read through the shared JS-integer reader with the
//! bounds its schema gives.

use seampact_json::{MAX_SAFE_INTEGER, js_integer, optional_js_integer};
use serde::Deserializer;

/// The lowest HTTP status an error, a response or an example carries.
const HTTP_STATUS_MIN: i64 = 100;

/// The highest HTTP status an error, a response or an example carries.
const HTTP_STATUS_MAX: i64 = 599;

/// The lowest status a name carries (`Name.status`).
const NAME_STATUS_MIN: i64 = 200;

/// The highest status a name carries (`Name.status`).
const NAME_STATUS_MAX: i64 = 399;

/// The longest address prefix, an IPv6 one (`ValueSource.prefixBits`).
const PREFIX_BITS_MAX: i64 = 128;

/// The highest first page or offset number (`PagingRequestRole.base`).
const PAGING_BASE_MAX: i64 = 1;

/// An integer from 1 to 2^53 - 1: a version, a revision, a line or a column.
pub(crate) fn positive<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    js_integer::<D, 1, MAX_SAFE_INTEGER>(deserializer)
}

/// An integer from 0 to 2^53 - 1: a size, a limit or a duration.
pub(crate) fn count<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    js_integer::<D, 0, MAX_SAFE_INTEGER>(deserializer)
}

/// An optional [`count`].
///
/// # Errors
///
/// The deserializer error when the value is no integer from 0 to 2^53 - 1.
pub fn optional_count<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, 0, MAX_SAFE_INTEGER>(deserializer)
}

/// An HTTP status.
pub(crate) fn http_status<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    js_integer::<D, HTTP_STATUS_MIN, HTTP_STATUS_MAX>(deserializer)
}

/// An optional HTTP status.
pub(crate) fn optional_http_status<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, HTTP_STATUS_MIN, HTTP_STATUS_MAX>(deserializer)
}

/// The optional status of a name.
pub(crate) fn optional_name_status<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, NAME_STATUS_MIN, NAME_STATUS_MAX>(deserializer)
}

/// The optional prefix length of an address.
pub(crate) fn optional_prefix_bits<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, 0, PREFIX_BITS_MAX>(deserializer)
}

/// The optional first page or offset number.
pub(crate) fn optional_paging_base<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    optional_js_integer::<D, 0, PAGING_BASE_MAX>(deserializer)
}
