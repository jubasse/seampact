//! What `tree.schemas` exposes to every later half.

use seampact_ir::{Direction, QueryWire, TypeUse};
use seampact_json::JsonValue;

use crate::PassError;

/// A problem an example has against a type use, located inside the example value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeSchemaExampleIssue {
    /// The JSON Pointer of the offending value inside the example (`""` for the example itself).
    pub pointer: String,
    /// What is wrong with the value.
    pub message: String,
}

/// The schema service `tree.schemas` hands to every later half (ADR 0006 section 2).
///
/// Pointers are JSON Pointers into the api's merged raw tree. Every method is pure and reports
/// nothing: `tree.schemas` reported every schema problem in its own run. An absent answer means
/// no schema is written at the pointer (or the pointer is no schema position). The service holds
/// no reference to the draft, and every answer is an owned value.
///
/// A call fails with [`PassError::NotPortedYet`] when it reaches a `tree.schemas` function not
/// ported yet, so a later half stops instead of reading a wrong answer.
pub trait TreeSchemaService: Send + Sync {
    /// The type use the schema written at `pointer` compiles to, used in `direction`.
    ///
    /// An inline object, map or union refers to the schema `tree.schemas` hoisted for it.
    ///
    /// # Errors
    ///
    /// A [`PassError`] when the answer cannot be computed.
    fn type_use(&self, pointer: &str, direction: Direction) -> Result<Option<TypeUse>, PassError>;

    /// The query wire form of the query or form field at `pointer` (ADR 0002 section 7), keyed by
    /// its position in the input schema, or of a rule proof schema (`/rules/<id>/proof/schema`).
    ///
    /// # Errors
    ///
    /// A [`PassError`] when the answer cannot be computed.
    fn query_wire(&self, pointer: &str) -> Result<Option<QueryWire>, PassError>;

    /// Checks an example value against a use; an empty list means the example fits.
    ///
    /// # Errors
    ///
    /// A [`PassError`] when the answer cannot be computed.
    fn check_example(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError>;

    /// Checks an example written as text against a use, the text read by the use's wire form; a
    /// use that is neither a scalar nor an enum has no text form and answers one issue.
    ///
    /// # Errors
    ///
    /// A [`PassError`] when the answer cannot be computed.
    fn check_text_example(
        &self,
        text: &str,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_service_can_be_shared_across_threads() {
        fn assert_send_and_sync<T: Send + Sync + ?Sized>() {}

        assert_send_and_sync::<dyn TreeSchemaService>();
        assert_send_and_sync::<Box<dyn TreeSchemaService>>();
    }
}
