//! What every comparison of the walk shares: the two IRs, their reach indexes and the sink, and the
//! generic member comparison driven by the member table.

use indexmap::IndexMap;
use seampact_diff_table::{DiffKind, DiffRefusal, IrDefinition, MemberRow, member_row};
use seampact_ir::ContractIr;
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue};

use crate::DiffError;
use crate::change_sink::{ChangeReach, ChangeSink, ElementOrigin, RawChange};
use crate::not_ported::not_ported_yet;
use crate::walk_json::{is_same_json, pointer_join};
use crate::walk_reach::ReachIndex;

/// The two IRs of one walk, their reach indexes and the sink that collects the changes.
#[derive(Debug)]
pub(crate) struct WalkContext<'run> {
    pub(crate) before: &'run ContractIr,
    pub(crate) after: &'run ContractIr,
    pub(crate) before_reach: ReachIndex,
    pub(crate) after_reach: ReachIndex,
    pub(crate) sink: ChangeSink,
}

/// Where the changes of one element go: its reaches, and its origin for the pack cause.
#[derive(Debug, Clone)]
pub(crate) struct ChangeSite<'site> {
    pub(crate) reaches: &'site [ChangeReach],
    pub(crate) origin: Option<ElementOrigin>,
}

/// The comparison of one member: the pointer, then the value before and the value after.
pub(crate) type MemberComparison<'comparison> = Box<
    dyn Fn(
            &mut WalkContext<'_>,
            &str,
            Option<&JsonValue>,
            Option<&JsonValue>,
        ) -> Result<(), DiffError>
        + 'comparison,
>;

/// The comparisons of the members that have one of their own, by member name.
pub(crate) type MemberComparisons<'comparison> =
    IndexMap<&'static str, MemberComparison<'comparison>>;

/// The rows whose change is only informative.
const INFORMATIVE_MEMBER_ROWS: [DiffKind; 2] = [DiffKind::Name, DiffKind::Annotation];

/// Records `change` at the reaches of `site`, with the origin of the site.
pub(crate) fn emit_at(context: &mut WalkContext<'_>, site: &ChangeSite<'_>, change: RawChange) {
    let raw = RawChange {
        origin: site.origin.clone(),
        ..change
    };

    context.sink.emit(&raw, site.reaches);
}

/// Compares the members of two objects by the sorted union of their names: a member with a
/// comparison goes to it, any other becomes the change its row in the member table says.
pub(crate) fn compare_members(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    definition: IrDefinition,
    pointer: &str,
    before: Option<&JsonObject>,
    after: Option<&JsonObject>,
    comparisons: &MemberComparisons<'_>,
) -> Result<(), DiffError> {
    let mut names: Vec<&str> = before
        .into_iter()
        .chain(after)
        .flat_map(|members| members.keys().map(String::as_str))
        .collect();

    names.sort_by(|left, right| cmp_utf16(left, right));
    names.dedup();

    for member in names {
        let before_value = before.and_then(|members| members.get(member));
        let after_value = after.and_then(|members| members.get(member));

        if is_same_json(before_value, after_value) {
            continue;
        }

        let member_pointer = pointer_join(pointer, &[member]);

        if let Some(comparison) = comparisons.get(member) {
            comparison(context, &member_pointer, before_value, after_value)?;

            continue;
        }

        let (kind, case_name) = row_change(definition, member);

        emit_at(
            context,
            site,
            RawChange {
                kind,
                case_name,
                pointer: member_pointer,
                before: before_value.cloned(),
                after: after_value.cloned(),
                origin: None,
                facts: Vec::new(),
            },
        );
    }

    Ok(())
}

/// The kind and case a member without a comparison is reported as.
fn row_change(definition: IrDefinition, member: &str) -> (DiffKind, String) {
    match member_row(definition, member) {
        MemberRow::Fixed { kind, case_name } => (kind, case_name.to_owned()),
        MemberRow::Kind(kind) if INFORMATIVE_MEMBER_ROWS.contains(&kind) => {
            (kind, member.to_owned())
        }
        MemberRow::Kind(_) => (
            DiffKind::Unclassified,
            format!("{}.{member}", definition.as_str()),
        ),
    }
}

/// The refusal for an open enum value the diff does not know, naming the member and the operations.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn unknown_value_refusal(
    _member: &str,
    _value: &str,
    _operations: &[String],
) -> Result<DiffRefusal, DiffError> {
    Err(not_ported_yet("unknownValueRefusal"))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashSet;

    use seampact_diff_table::DiffClassification;
    use seampact_json::JsonNumber;

    use super::*;
    use crate::change_sink::NO_POSITION;
    use crate::sample_ir::sample_ir;
    use crate::walk_reach::ReachIndex;

    fn members(names: &[&str]) -> JsonObject {
        let mut object = JsonObject::new();

        for name in names {
            object.insert(
                (*name).to_owned(),
                JsonValue::Number(JsonNumber::from_i64(1)),
            );
        }

        object
    }

    fn context(ir: &ContractIr) -> WalkContext<'_> {
        WalkContext {
            before: ir,
            after: ir,
            before_reach: ReachIndex::new(),
            after_reach: ReachIndex::new(),
            sink: ChangeSink::new(HashSet::new()),
        }
    }

    #[test]
    fn members_are_compared_in_utf16_code_unit_order() {
        let ir = sample_ir();
        let mut walk = context(&ir);
        let site = ChangeSite {
            reaches: &NO_POSITION,
            origin: None,
        };
        let seen = RefCell::new(Vec::new());
        let names = ["\u{FF5E}", "b", "\u{10000}"];
        let mut comparisons = MemberComparisons::new();

        for name in names {
            comparisons.insert(
                name,
                Box::new(|_context, pointer, _before, _after| {
                    seen.borrow_mut().push(pointer.to_owned());

                    Ok(())
                }),
            );
        }

        compare_members(
            &mut walk,
            &site,
            IrDefinition::Name,
            "",
            Some(&members(&names)),
            None,
            &comparisons,
        )
        .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(
            seen.borrow().clone(),
            vec![
                "/b".to_owned(),
                "/\u{10000}".to_owned(),
                "/\u{FF5E}".to_owned()
            ]
        );
    }

    #[test]
    fn a_member_without_a_comparison_follows_its_row() {
        let ir = sample_ir();
        let mut walk = context(&ir);
        let site = ChangeSite {
            reaches: &NO_POSITION,
            origin: None,
        };

        compare_members(
            &mut walk,
            &site,
            IrDefinition::Name,
            "/name",
            Some(&members(&["segments", "nothing"])),
            Some(&members(&["nothing"])),
            &MemberComparisons::new(),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let rows: Vec<(DiffKind, String, DiffClassification)> = walk
            .sink
            .sorted_changes()
            .into_iter()
            .map(|change| (change.kind, change.case_name, change.classification))
            .collect();

        assert_eq!(
            rows,
            vec![(
                DiffKind::Name,
                "segments".to_owned(),
                DiffClassification::Informative
            )]
        );

        let mut other = context(&ir);

        compare_members(
            &mut other,
            &site,
            IrDefinition::Name,
            "",
            Some(&members(&["nothing"])),
            None,
            &MemberComparisons::new(),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let unlisted = other.sink.sorted_changes();

        assert_eq!(
            unlisted
                .first()
                .map(|change| (change.kind, change.case_name.as_str())),
            Some((DiffKind::Unclassified, "Name.nothing"))
        );
    }
}
