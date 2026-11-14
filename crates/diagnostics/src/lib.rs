//! Diagnostics of the Rust port: what every layer reports and how it is shown.
//!
//! A [`Diagnostic`] carries a rule id, a severity, a message, a fix and the origin it is
//! located at, plus related origins. Passes push them onto a [`DiagnosticSink`] in emit
//! order; [`diagnostic_sort`] gives the order users see and [`print_diagnostics`] the one
//! line per diagnostic editors read. A bug is an [`InternalError`], never a diagnostic, and
//! ends the run with [`EXIT_INTERNAL`]. [`diagnostics_json`] builds the value of `diagnostics.json`.

mod diagnostic;
mod diagnostics_json;
mod internal;
mod mapping_keys;
mod print;
mod sink;
mod text;

pub use diagnostic::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, RelatedLocation, RuleId, Severity,
};
pub use diagnostics_json::{ApiDiagnostics, diagnostics_json};
pub use internal::{EXIT_INTERNAL, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE, InternalError};
pub use mapping_keys::mapping_keys_hint;
pub use print::{
    PrintedLocation, diagnostic_inert, diagnostic_location, diagnostic_location_key,
    diagnostic_sort, print_diagnostics,
};
pub use sink::DiagnosticSink;
pub use text::{access_rights_quoted, quote, quote_text};
