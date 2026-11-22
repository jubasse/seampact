//! `seampact explain`: the target a command line names.

use crate::api_refs::{ApiRef, parse_api_ref};

/// Separates the api from the operation id in `<api>.<operationId>`.
const OPERATION_SEPARATOR: char = '.';

/// What `explain` was asked to print: an operation, and the api it belongs to when given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExplainTarget<'text> {
    pub(crate) api: Option<ApiRef<'text>>,
    pub(crate) api_text: Option<&'text str>,
    pub(crate) operation_id: &'text str,
}

/// The operation id alone, or `<api>.<operationId>` split at its last separator.
pub(crate) fn explain_target(text: &str) -> ExplainTarget<'_> {
    match text.rsplit_once(OPERATION_SEPARATOR) {
        None => ExplainTarget {
            api: None,
            api_text: None,
            operation_id: text,
        },
        Some((api_text, operation_id)) => ExplainTarget {
            api: Some(parse_api_ref(api_text)),
            api_text: Some(api_text),
            operation_id,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operation_id_follows_the_last_dot() {
        let target = explain_target("billing/orders.v2.getOrder");

        assert_eq!(target.api_text, Some("billing/orders.v2"));
        assert_eq!(target.operation_id, "getOrder");
        assert_eq!(
            target.api,
            Some(ApiRef {
                source: Some("billing"),
                api: "orders.v2"
            })
        );
        assert_eq!(explain_target("getOrder").api, None);
    }
}
