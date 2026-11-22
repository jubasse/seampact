//! Maturity levels in the order of their promise.

use seampact_diff_table::DiffKind;
use seampact_ir::Maturity;

use crate::change_sink::RawChange;
use crate::walk_context::{ChangeSite, WalkContext, emit_at, refuse_unknown_value};
use crate::walk_json::text_value;

/// Whether `level` is one this diff ranks.
pub(crate) fn is_known_maturity(level: &Maturity) -> bool {
    maturity_rank(level).is_some()
}

/// The promise of a level: the higher, the more clients may rely on it.
fn maturity_rank(level: &Maturity) -> Option<u8> {
    match level {
        Maturity::Experimental => Some(0),
        Maturity::Provisional => Some(1),
        Maturity::Stable => Some(2),
        Maturity::Unknown(_) => None,
    }
}

/// A `lowered` or `raised` change when the level moves; an unknown level refuses the diff.
pub(crate) fn compare_maturity_level(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Maturity,
    after: &Maturity,
) {
    let (Some(before_rank), Some(after_rank)) = (maturity_rank(before), maturity_rank(after))
    else {
        let unknown = if maturity_rank(before).is_none() {
            before
        } else {
            after
        };

        refuse_unknown_value(context, site, pointer, unknown.as_str());

        return;
    };

    if before_rank == after_rank {
        return;
    }

    let rank_case = if after_rank < before_rank {
        "lowered"
    } else {
        "raised"
    };

    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Maturity, rank_case, pointer.to_owned()).between(
            Some(text_value(before.as_str())),
            Some(text_value(after.as_str())),
        ),
    );
}
