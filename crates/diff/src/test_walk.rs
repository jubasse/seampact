//! The harness the unit tests of the walk share: a context over two IRs and the changes a
//! comparison emits there.

use std::collections::HashSet;

use seampact_ir::ContractIr;
use serde::de::DeserializeOwned;

use crate::DiffError;
use seampact_diff_table::DiffPosition;

use crate::change_sink::{ChangeReach, ChangeSink};
use crate::walk_context::{ChangeSite, WalkContext};
use crate::walk_reach::ReachIndex;

/// Runs `walk` over a context of `before` and `after`; each change comes back as
/// `Kind:case@pointer`, in the order of the sink. The changes are reached at the input position.
pub(crate) fn changes_of(
    before: &ContractIr,
    after: &ContractIr,
    walk: impl FnOnce(&mut WalkContext<'_>, &ChangeSite<'_>) -> Result<(), DiffError>,
) -> Result<Vec<String>, DiffError> {
    let mut context = WalkContext {
        before,
        after,
        before_reach: ReachIndex::new(),
        after_reach: ReachIndex::new(),
        sink: ChangeSink::new(HashSet::new()),
    };
    let reaches = [ChangeReach {
        position: DiffPosition::Input,
        operations: Vec::new(),
        facts: Vec::new(),
    }];
    let site = ChangeSite {
        reaches: &reaches,
        origin: None,
    };

    walk(&mut context, &site)?;

    Ok(context
        .sink
        .sorted_changes()
        .into_iter()
        .map(|change| format!("{:?}:{}@{}", change.kind, change.case_name, change.pointer))
        .collect())
}

/// An IR value written as JSON.
pub(crate) fn ir_value<Value: DeserializeOwned>(json: serde_json::Value) -> Value {
    let text = json.to_string();

    serde_json::from_value(json).unwrap_or_else(|error| panic!("{text}: {error}"))
}
