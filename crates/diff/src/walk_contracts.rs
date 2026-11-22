//! The structural walk of two IRs of one api: every top-level member is compared, by the walk of its
//! own or by its row in the member table, so every difference becomes a change or a refusal.

use seampact_diagnostics::InternalError;
use seampact_diff_table::{DiffChange, DiffRefusal, IrDefinition};
use seampact_ir::ContractIr;
use seampact_json::{JsonObject, JsonValue};

use crate::DiffError;
use crate::change_sink::{ChangeSink, NO_POSITION};
use crate::walk_api::{changed_pack_names, compare_api, compare_packs};
use crate::walk_catalogue::{
    compare_enum_catalogue, compare_scalar_catalogue, compare_schema_catalogue,
};
use crate::walk_context::{
    ChangeSite, MemberComparison, MemberComparisons, WalkContext, compare_members,
};
use crate::walk_declarations::{DeclarationCatalogue, compare_declarations};
use crate::walk_operations::compare_operations;
use crate::walk_reach::build_reach_index;

/// The changes and the refusals of one walk.
#[derive(Debug)]
pub(crate) struct WalkOutcome {
    pub(crate) changes: Vec<DiffChange>,
    pub(crate) refusals: Vec<DiffRefusal>,
}

/// Walks `before` and `after` and collects every change and refusal.
///
/// # Errors
///
/// [`DiffError::Internal`] when an IR does not encode; [`DiffError::NotPortedYet`] until every
/// comparison is ported.
pub(crate) fn walk_contracts(
    before: &ContractIr,
    after: &ContractIr,
) -> Result<WalkOutcome, DiffError> {
    let mut context = WalkContext {
        before,
        after,
        before_reach: build_reach_index(before)?,
        after_reach: build_reach_index(after)?,
        sink: ChangeSink::new(changed_pack_names(&before.packs, &after.packs)),
    };
    let site = ChangeSite {
        reaches: &NO_POSITION,
        origin: None,
    };
    let mut comparisons = MemberComparisons::new();

    for catalogue in DeclarationCatalogue::ALL {
        comparisons.insert(
            catalogue.as_str(),
            Box::new(move |context, _pointer, _before, _after| {
                compare_declarations(context, catalogue)
            }),
        );
    }

    comparisons.insert("irVersion", no_comparison());
    comparisons.insert("irRevision", no_comparison());
    comparisons.insert(
        "api",
        Box::new(|context, _pointer, _before, _after| compare_api(context)),
    );
    comparisons.insert(
        "packs",
        Box::new(|context, _pointer, _before, _after| {
            compare_packs(context, &before.packs, &after.packs);

            Ok(())
        }),
    );
    comparisons.insert(
        "schemas",
        Box::new(|context, _pointer, _before, _after| compare_schema_catalogue(context)),
    );
    comparisons.insert(
        "scalars",
        Box::new(|context, _pointer, _before, _after| compare_scalar_catalogue(context)),
    );
    comparisons.insert(
        "enums",
        Box::new(|context, _pointer, _before, _after| compare_enum_catalogue(context)),
    );
    comparisons.insert(
        "operations",
        Box::new(|context, _pointer, _before, _after| compare_operations(context)),
    );

    let before_members = members_of(before)?;
    let after_members = members_of(after)?;

    compare_members(
        &mut context,
        &site,
        IrDefinition::ContractIr,
        "",
        Some(&before_members),
        Some(&after_members),
        &comparisons,
    )?;

    Ok(WalkOutcome {
        changes: context.sink.sorted_changes(),
        refusals: context.sink.refusals().to_vec(),
    })
}

/// A member the walk leaves to another comparison.
fn no_comparison() -> MemberComparison<'static> {
    Box::new(|_context, _pointer, _before, _after| Ok(()))
}

fn members_of(ir: &ContractIr) -> Result<JsonObject, DiffError> {
    match ir
        .to_json_value()
        .map_err(|error| InternalError::new(error.to_string()))?
    {
        JsonValue::Object(members) => Ok(members),
        other => {
            Err(InternalError::new(format!("the IR encodes as {other:?}, not an object")).into())
        }
    }
}
