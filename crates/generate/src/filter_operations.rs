//! The operations an entry keeps of an api: its `document`, then `operations.include` and
//! `operations.exclude`.

use seampact_cli_config::{CliProblem, OperationsFilter, unlocated_problem};
use seampact_ir::{ContractIr, InternalPolicy, Operation};

const NO_DOCUMENT_DECLARED: &str = "none declared";
const NO_DOCUMENT_SELECTED: &str = "(none)";

/// The document and operations an entry or a served api keeps.
#[derive(Debug, Clone, Copy, Default)]
pub struct OperationSelection<'selection> {
    /// The `api.documents` id.
    pub document: Option<&'selection str>,
    /// The operation ids and tags kept or dropped.
    pub operations: Option<&'selection OperationsFilter>,
}

/// The IR the selection leaves, or why it names something the api does not have.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterOutcome {
    /// A copy of the IR holding only the kept operations.
    Filtered(Box<ContractIr>),
    /// The problems, none located.
    Refused(Vec<CliProblem>),
}

fn matches(operation: &Operation, item: &str) -> bool {
    operation.id.as_str() == item || operation.tags.iter().any(|tag| tag == item)
}

/// Whether `operation` is in the document `document_id`; every operation is when there is none.
#[must_use]
pub fn is_in_document(ir: &ContractIr, document_id: Option<&str>, operation: &Operation) -> bool {
    let Some(document_id) = document_id else {
        return true;
    };
    let Some(document) = ir.api.documents.get(document_id) else {
        return false;
    };

    if document.internal == InternalPolicy::Exclude && operation.internal {
        return false;
    }

    document.surfaces.contains(&operation.surface)
}

fn unknown_selection_problems(
    ir: &ContractIr,
    selection: &OperationSelection<'_>,
) -> Vec<CliProblem> {
    let api_id = &ir.api.id;
    let document_ids: Vec<&str> = ir
        .api
        .documents
        .keys()
        .map(seampact_ir::DocumentId::as_str)
        .collect();
    let mut problems = Vec::new();

    if let Some(document) = selection.document
        && !document_ids.contains(&document)
    {
        let declared = if document_ids.is_empty() {
            NO_DOCUMENT_DECLARED.to_owned()
        } else {
            document_ids.join(", ")
        };

        problems.push(unlocated_problem(
            "filter.document.unknown",
            format!("The api '{api_id}' declares no document '{document}' ({declared})."),
            "Name one of the api's `documents` in `document`, or remove `document`.",
        ));
    }

    let items = selection.operations.into_iter().flat_map(|filter| {
        filter
            .include
            .iter()
            .flatten()
            .chain(filter.exclude.iter().flatten())
    });

    for item in items {
        if ir
            .operations
            .iter()
            .any(|operation| matches(operation, item))
        {
            continue;
        }

        problems.push(unlocated_problem(
            "filter.operation.unknown",
            format!("The api '{api_id}' has no operation id or tag '{item}'."),
            "Name an operation id or a tag of the api in `operations.include` or `operations.exclude`.",
        ));
    }

    problems
}

/// The IR with only the operations `selection` keeps, or the problems of what it names.
#[must_use]
pub fn filter_operations(ir: &ContractIr, selection: &OperationSelection<'_>) -> FilterOutcome {
    let problems = unknown_selection_problems(ir, selection);

    if !problems.is_empty() {
        return FilterOutcome::Refused(problems);
    }

    let in_document: Vec<&Operation> = ir
        .operations
        .iter()
        .filter(|operation| is_in_document(ir, selection.document, operation))
        .collect();
    let include: &[String] = selection
        .operations
        .and_then(|filter| filter.include.as_deref())
        .unwrap_or_default();
    let exclude: &[String] = selection
        .operations
        .and_then(|filter| filter.exclude.as_deref())
        .unwrap_or_default();

    let removed: Vec<&String> = include
        .iter()
        .filter(|item| !in_document.iter().any(|operation| matches(operation, item)))
        .collect();

    if !removed.is_empty() {
        let document = selection.document.unwrap_or(NO_DOCUMENT_SELECTED);

        return FilterOutcome::Refused(
            removed
                .into_iter()
                .map(|item| {
                    unlocated_problem(
                        "filter.include.removed",
                        format!(
                            "The api '{}' keeps no operation for the include item '{item}' once the document '{document}' has run.",
                            ir.api.id
                        ),
                        "Remove the item from `operations.include`, or choose a document that keeps it.",
                    )
                })
                .collect(),
        );
    }

    let kept: Vec<Operation> = in_document
        .into_iter()
        .filter(|operation| {
            (include.is_empty() || include.iter().any(|item| matches(operation, item)))
                && !exclude.iter().any(|item| matches(operation, item))
        })
        .cloned()
        .collect();
    let mut filtered = ir.clone();

    filtered.operations = kept;

    FilterOutcome::Filtered(Box::new(filtered))
}
