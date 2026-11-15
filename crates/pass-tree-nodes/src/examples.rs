//! The `examples` of an operation: each one read, and its value checked against the input or response it targets.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{ArrayTypeUse, ErrorCode, OperationExample, Response, ResponseShape, TypeUse};
use seampact_js::js_key_order;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_member;
use seampact_pipeline::{PassError, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::paging::number_of;
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

/// The examples a route writes, each checked where it targets the request or a success status.
pub(crate) fn tree_nodes_examples(
    site: &TreeNodesSite<'_, '_>,
    input: Option<&TypeUse>,
    responses: &[Response],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<IndexMap<String, OperationExample>, PassError> {
    let mut examples = IndexMap::new();
    let Some(JsonValue::Object(written)) = site.node.settings.get("examples") else {
        return Ok(examples);
    };
    let targets = ExampleTargets { input, responses };

    for (name, entry) in js_key_order(written.iter()) {
        let example = example_of(entry)?;
        let pointer = pointer_below(&format!("{}/examples", site.node.pointer), &[name]);

        examples.insert(name.clone(), example.clone());

        let checked = WrittenExample {
            name: name.clone(),
            pointer,
            example,
            value: tree_nodes_member(Some(entry), "value"),
        };

        check_example(site, &checked, &targets, scope)?;
    }

    Ok(examples)
}

fn example_of(entry: &JsonValue) -> Result<OperationExample, PassError> {
    let status = number_of(tree_nodes_member(Some(entry), "status"))?;
    let request = matches!(
        tree_nodes_member(Some(entry), "request"),
        Some(JsonValue::Bool(true))
    );
    let error = match tree_nodes_member(Some(entry), "error") {
        Some(JsonValue::String(code)) => Some(ErrorCode::new(code.clone())),
        _ => None,
    };
    let Some(value) = tree_nodes_member(Some(entry), "value") else {
        return Err(InternalError::new("an example is written without a value").into());
    };

    Ok(OperationExample {
        status,
        request: request.then_some(true),
        error,
        value: value.clone(),
    })
}

fn check_value(
    site: &TreeNodesSite<'_, '_>,
    name: &str,
    pointer: &str,
    value: &JsonValue,
    type_use: &TypeUse,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    for issue in scope.schemas.check_example(value, type_use)? {
        report_issue(
            site,
            name,
            pointer,
            &ExampleIssue {
                pointer: issue.pointer,
                message: issue.message,
            },
            scope,
        )?;
    }

    Ok(())
}

fn written_value<'tree>(
    value: Option<&'tree JsonValue>,
    pointer: &str,
) -> Result<&'tree JsonValue, InternalError> {
    value.ok_or_else(|| InternalError::new(format!("the example at {pointer} has no value")))
}

fn check_example(
    site: &TreeNodesSite<'_, '_>,
    written: &WrittenExample<'_>,
    targets: &ExampleTargets<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let WrittenExample {
        name,
        pointer,
        example,
        value,
    } = written;
    let stated = usize::from(example.status.is_some())
        + usize::from(example.request.is_some())
        + usize::from(example.error.is_some());

    if stated != 1 {
        return report_target(
            site,
            name,
            pointer,
            "targets no single status, request or error",
            scope,
        );
    }

    if example.error.is_some() {
        return Ok(());
    }

    let value_pointer = format!("{pointer}/value");

    if example.request == Some(true) {
        let Some(input) = targets.input else {
            return report_target(
                site,
                name,
                pointer,
                "targets the request, but the route has no input",
                scope,
            );
        };

        return check_value(
            site,
            name,
            &value_pointer,
            written_value(*value, &value_pointer)?,
            input,
            scope,
        );
    }

    let Some(status) = example.status else {
        return Err(InternalError::new(format!(
            "the example at {pointer} targets no status, request or error"
        ))
        .into());
    };
    let Some(response) = targets
        .responses
        .iter()
        .find(|candidate| candidate.status == status)
    else {
        return report_target(
            site,
            name,
            pointer,
            &format!("targets the status {status}, which the route does not declare"),
            scope,
        );
    };

    if response.body.is_none() {
        return report_target(
            site,
            name,
            pointer,
            &format!("targets the status {status}, which answers no body"),
            scope,
        );
    }

    check_success(site, name, &value_pointer, *value, response, scope)
}

fn check_success(
    site: &TreeNodesSite<'_, '_>,
    name: &str,
    pointer: &str,
    value: Option<&JsonValue>,
    response: &Response,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(body) = &response.body else {
        return Ok(());
    };

    if ARRAY_SHAPES.contains(&response.shape) {
        let items = TypeUse::Array(ArrayTypeUse {
            items: Box::new(body.clone()),
            min_items: None,
            max_items: None,
            nullable: None,
            docs: None,
            examples: None,
        });

        return check_value(
            site,
            name,
            pointer,
            written_value(value, pointer)?,
            &items,
            scope,
        );
    }

    if response.shape != TABLE_SHAPE {
        return check_value(
            site,
            name,
            pointer,
            written_value(value, pointer)?,
            body,
            scope,
        );
    }

    // A table has no type use of its own: each entry is one record.
    let Some(JsonValue::Object(entries)) = value else {
        return report_issue(
            site,
            name,
            pointer,
            &ExampleIssue {
                pointer: String::new(),
                message: "a table example is an object keyed by id".to_owned(),
            },
            scope,
        );
    };
    let id_use = table_id_use(site, scope)?;

    for (id, record) in js_key_order(entries.iter()) {
        let entry_pointer = pointer_below(pointer, &[id]);

        for issue in scope.schemas.check_text_example(id, &id_use)? {
            report_key_issue(
                site,
                &TableKey {
                    name: name.to_owned(),
                    pointer: entry_pointer.clone(),
                    key: id.clone(),
                },
                &issue.message,
                scope,
            )?;
        }

        check_value(site, name, &entry_pointer, record, body, scope)?;
    }

    Ok(())
}

fn report_target(
    site: &TreeNodesSite<'_, '_>,
    name: &str,
    pointer: &str,
    why: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let origin = scope
        .context
        .origin(pointer)
        .unwrap_or_else(|| site.node.origin.clone());

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::ExampleTarget,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!("The example {name} of {} {why}.", site.operation_id),
            fix: "Give the example one of status (a success with a body), request: true (on a route with input) or error.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
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
