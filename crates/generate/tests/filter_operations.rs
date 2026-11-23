//! The operations an entry keeps of an api, and what it is refused for naming.

mod support;

use seampact_cli_config::OperationsFilter;
use seampact_generate::{FilterOutcome, OperationSelection, filter_operations};
use support::{TestResult, reference_ir};

fn kept_ids(outcome: FilterOutcome) -> TestResult<Vec<String>> {
    match outcome {
        FilterOutcome::Filtered(ir) => Ok(ir
            .operations
            .iter()
            .map(|each| each.id.to_string())
            .collect()),
        FilterOutcome::Refused(problems) => Err(format!("refused: {problems:?}").into()),
    }
}

fn codes(outcome: FilterOutcome) -> TestResult<Vec<String>> {
    match outcome {
        FilterOutcome::Refused(problems) => {
            Ok(problems.into_iter().map(|each| each.code).collect())
        }
        FilterOutcome::Filtered(_) => Err("the selection was not refused".into()),
    }
}

fn filter(include: &[&str], exclude: &[&str]) -> OperationsFilter {
    let owned = |items: &[&str]| {
        (!items.is_empty()).then(|| items.iter().map(|each| (*each).to_owned()).collect())
    };

    OperationsFilter {
        include: owned(include),
        exclude: owned(exclude),
    }
}

#[test]
fn a_document_drops_the_internal_operations_it_excludes() -> TestResult<()> {
    let ir = reference_ir()?;
    let public = kept_ids(filter_operations(
        &ir,
        &OperationSelection {
            document: Some("public"),
            operations: None,
        },
    ))?;
    let full = kept_ids(filter_operations(
        &ir,
        &OperationSelection {
            document: Some("full"),
            operations: None,
        },
    ))?;

    assert!(
        !public.contains(&"archiveTask".to_owned()),
        "public: {public:?}"
    );
    assert!(full.contains(&"archiveTask".to_owned()), "full: {full:?}");
    assert_eq!(full.len(), ir.operations.len());

    Ok(())
}

#[test]
fn include_and_exclude_narrow_the_operations_by_id() -> TestResult<()> {
    let ir = reference_ir()?;
    let operations = filter(&["getTask", "createTask", "assignTask"], &["assignTask"]);
    let kept = kept_ids(filter_operations(
        &ir,
        &OperationSelection {
            document: None,
            operations: Some(&operations),
        },
    ))?;

    assert_eq!(kept, ["createTask", "getTask"]);

    Ok(())
}

#[test]
fn an_include_item_the_document_removed_is_refused() -> TestResult<()> {
    let ir = reference_ir()?;
    let operations = filter(&["archiveTask"], &[]);
    let outcome = filter_operations(
        &ir,
        &OperationSelection {
            document: Some("public"),
            operations: Some(&operations),
        },
    );

    assert_eq!(codes(outcome)?, ["filter.include.removed"]);

    Ok(())
}

#[test]
fn an_unknown_document_and_unknown_items_are_refused_together() -> TestResult<()> {
    let ir = reference_ir()?;
    let operations = filter(&["noSuchOperation"], &[]);
    let outcome = filter_operations(
        &ir,
        &OperationSelection {
            document: Some("missing"),
            operations: Some(&operations),
        },
    );

    assert_eq!(
        codes(outcome)?,
        ["filter.document.unknown", "filter.operation.unknown"]
    );

    Ok(())
}
