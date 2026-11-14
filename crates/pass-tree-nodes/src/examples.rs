//! The `examples` of an operation: each one read, and its value checked against the input or response it targets.

use indexmap::IndexMap;
use seampact_ir::{OperationExample, Response, ResponseShape, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The shapes whose handler result is an array of the body's item.
const ARRAY_SHAPES: &[ResponseShape] = &[ResponseShape::List, ResponseShape::Page];
const TABLE_SHAPE: ResponseShape = ResponseShape::Table;

/// What an example may target: the input and the responses of its operation.
#[derive(Debug, Clone, Copy)]
struct ExampleTargets<'operation> {
    input: Option<&'operation TypeUse>,
    responses: &'operation [Response],
}

/// An example as written, with where it is written.
#[derive(Debug, Clone)]
struct WrittenExample<'tree> {
    name: String,
    pointer: String,
    example: OperationExample,
    value: Option<&'tree JsonValue>,
}

/// A key of a table example.
#[derive(Debug, Clone)]
struct TableKey {
    name: String,
    pointer: String,
    key: String,
}

/// What the schema service found wrong in an example value.
#[derive(Debug, Clone)]
struct ExampleIssue {
    pointer: String,
    message: String,
}

pub(crate) fn tree_nodes_examples(
    _site: &TreeNodesSite<'_, '_>,
    _input: Option<&TypeUse>,
    _responses: &[Response],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<IndexMap<String, OperationExample>, PassError> {
    Err(not_ported_yet("treeNodesExamples"))
}

fn example_of(_entry: &JsonValue) -> Result<OperationExample, PassError> {
    Err(not_ported_yet("exampleOf"))
}

fn check_value(
    _site: &TreeNodesSite<'_, '_>,
    _name: &str,
    _pointer: &str,
    _value: &JsonValue,
    _type_use: &TypeUse,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkValue"))
}

fn check_example(
    _site: &TreeNodesSite<'_, '_>,
    _written: &WrittenExample<'_>,
    _targets: &ExampleTargets<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkExample"))
}

fn check_success(
    _site: &TreeNodesSite<'_, '_>,
    _name: &str,
    _pointer: &str,
    _value: Option<&JsonValue>,
    _response: &Response,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkSuccess"))
}

fn report_target(
    _site: &TreeNodesSite<'_, '_>,
    _name: &str,
    _pointer: &str,
    _why: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportTarget"))
}

fn report_key_issue(
    _site: &TreeNodesSite<'_, '_>,
    _table_key: &TableKey,
    _why: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportKeyIssue"))
}

fn table_id_use(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<TypeUse, PassError> {
    Err(not_ported_yet("tableIdUse"))
}

fn report_issue(
    _site: &TreeNodesSite<'_, '_>,
    _name: &str,
    _pointer: &str,
    _issue: &ExampleIssue,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportIssue"))
}
