//! The operations an entry keeps of an api: its `document`, then `operations.include` and
//! `operations.exclude`.

use seampact_cli_config::{CliProblem, OperationsFilter, Problems, unlocated_problem};
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

/// The IR with only the operations `selection` keeps.
///
/// # Errors
///
/// [`Problems`], none located, for a document, an operation id or a tag the api does not have,
/// and for an include item the document leaves nothing of.
pub fn filter_operations(
    ir: &ContractIr,
    selection: &OperationSelection<'_>,
) -> Result<ContractIr, Problems> {
    Problems::refuse_any(unknown_selection_problems(ir, selection))?;

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

    let removed_problems: Vec<CliProblem> = include
        .iter()
        .filter(|item| !in_document.iter().any(|operation| matches(operation, item)))
        .map(|item| {
            unlocated_problem(
                "filter.include.removed",
                format!(
                    "The api '{}' keeps no operation for the include item '{item}' once the document '{}' has run.",
                    ir.api.id,
                    selection.document.unwrap_or(NO_DOCUMENT_SELECTED)
                ),
                "Remove the item from `operations.include`, or choose a document that keeps it.",
            )
        })
        .collect();

    Problems::refuse_any(removed_problems)?;

    let kept: Vec<Operation> = in_document
        .into_iter()
        .filter(|operation| {
            (include.is_empty() || include.iter().any(|item| matches(operation, item)))
                && !exclude.iter().any(|item| matches(operation, item))
        })
        .cloned()
        .collect();

    Ok(with_operations(ir, kept))
}

/// A copy of `ir` that holds `operations` instead of its own, so the dropped ones are never cloned.
pub(crate) fn with_operations(ir: &ContractIr, operations: Vec<Operation>) -> ContractIr {
    // Listing every member, with no `..`, makes a member added to the IR break this copy.
    let ContractIr {
        ir_version,
        ir_revision,
        kinds,
        features,
        api,
        packs,
        conventions,
        formats,
        pagings,
        schemas,
        scalars,
        enums,
        errors,
        natures,
        schemes,
        headers,
        identities,
        rights,
        rules,
        scopes,
        buckets,
        services,
        extension_keys,
        lint,
        operations: _,
    } = ir;

    ContractIr {
        ir_version: *ir_version,
        ir_revision: *ir_revision,
        kinds: kinds.clone(),
        features: features.clone(),
        api: api.clone(),
        packs: packs.clone(),
        conventions: conventions.clone(),
        formats: formats.clone(),
        pagings: pagings.clone(),
        schemas: schemas.clone(),
        scalars: scalars.clone(),
        enums: enums.clone(),
        errors: errors.clone(),
        natures: natures.clone(),
        schemes: schemes.clone(),
        headers: headers.clone(),
        identities: identities.clone(),
        rights: rights.clone(),
        rules: rules.clone(),
        scopes: scopes.clone(),
        buckets: buckets.clone(),
        services: services.clone(),
        extension_keys: extension_keys.clone(),
        lint: lint.clone(),
        operations,
    }
}
