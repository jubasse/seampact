//! Where a generated form comes from in the IR.

use seampact_ir::OperationId;
use seampact_json::escape_pointer;

/// Where a generated form comes from in the IR: a JSON Pointer, and the operation it belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IrLocation {
    /// The JSON Pointer of the member.
    pub member: String,
    /// The operation the member belongs to, if any.
    pub operation: Option<OperationId>,
}

impl IrLocation {
    /// The location of the schema `schema_id`: `/schemas/<schema id>`.
    #[must_use]
    pub fn schema_location(schema_id: &str) -> Self {
        let root = Self {
            member: String::new(),
            operation: None,
        };

        root.below(&["schemas", schema_id])
    }

    /// The location of the operation at `operation_index` of the IR's `operations`.
    #[must_use]
    pub fn operation_location(operation_index: usize, operation_id: OperationId) -> Self {
        Self {
            member: format!("/operations/{operation_index}"),
            operation: Some(operation_id),
        }
    }

    /// The location of a member below this one, each segment escaped as a JSON Pointer token
    /// (RFC 6901); an index segment is its decimal text.
    #[must_use]
    pub fn below(&self, segments: &[&str]) -> Self {
        let tokens: Vec<String> = segments
            .iter()
            .map(|segment| escape_pointer(segment))
            .collect();

        Self {
            member: format!("{}/{}", self.member, tokens.join("/")),
            operation: self.operation.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_location_below_escapes_each_segment_and_keeps_the_operation() {
        let operation = IrLocation::operation_location(3, OperationId::from_static("getUser"));

        let below = operation.below(&["responses", "a/b~c", "0"]);

        assert_eq!(below.member, "/operations/3/responses/a~1b~0c/0");
        assert_eq!(below.operation, Some(OperationId::from_static("getUser")));
        assert_eq!(IrLocation::schema_location("User").member, "/schemas/User");
    }

    #[test]
    fn no_segment_below_adds_a_trailing_slash_as_the_typescript_does() {
        let schema = IrLocation::schema_location("User");

        assert_eq!(schema.below(&[]).member, "/schemas/User/");
    }
}
