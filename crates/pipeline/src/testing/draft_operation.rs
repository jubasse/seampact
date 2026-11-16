//! A draft operation for the tests of a half that reads one.

use seampact_ir::OperationId;

use crate::DraftOperation;
use crate::testing::api_layer_origin;

/// A draft operation of `id` written at the `api` layer pointer `pointer`, every other member
/// absent until the test sets it.
#[must_use]
pub fn draft_operation(id: &str, pointer: &str) -> DraftOperation {
    DraftOperation {
        id: Some(OperationId::new(id.to_owned())),
        origin: Some(api_layer_origin(pointer)),
        ..DraftOperation::default()
    }
}
