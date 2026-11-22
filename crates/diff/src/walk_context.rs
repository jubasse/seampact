//! What every comparison of the walk shares: the two IRs, their reach indexes and the sink, and the
//! generic member comparison driven by the member table.

use indexmap::IndexMap;
use seampact_diff_table::{
    DiffCode, DiffKind, DiffPosition, DiffRefusal, IrDefinition, MemberRow, member_row,
};
use seampact_ir::ContractIr;
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue, stringify_json};
use serde::Serialize;

use crate::DiffError;
use crate::change_sink::{ChangeReach, ChangeSink, ElementOrigin, RawChange};
use crate::walk_json::{is_same_json, json_of, member_names, pointer_join};
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

/// What names the rows of a member: a table definition, or a catalogue whose entry has a kind no
/// definition lists, so its members have no row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemberDefinition {
    Table(IrDefinition),
    Catalogue(&'static str),
}

impl From<IrDefinition> for MemberDefinition {
    fn from(definition: IrDefinition) -> Self {
        Self::Table(definition)
    }
}

/// Joins the names a kept-order comparison compares.
const NAME_SEPARATOR: &str = "\u{0}";

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
    definition: impl Into<MemberDefinition>,
    pointer: &str,
    before: Option<&JsonObject>,
    after: Option<&JsonObject>,
    comparisons: &MemberComparisons<'_>,
) -> Result<(), DiffError> {
    let definition = definition.into();

    for member in member_names(before, after) {
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
fn row_change(definition: MemberDefinition, member: &str) -> (DiffKind, String) {
    match definition {
        MemberDefinition::Catalogue(catalogue) => {
            (DiffKind::Unclassified, format!("{catalogue}.{member}"))
        }
        MemberDefinition::Table(table_definition) => table_row_change(table_definition, member),
    }
}

fn table_row_change(definition: IrDefinition, member: &str) -> (DiffKind, String) {
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

/// The fix every unknown-value refusal gives.
const UNKNOWN_VALUE_FIX: &str = "Run a @seampact/diff that reads this IR revision.";

/// The refusal for an open enum value the diff does not know, naming the member and the operations.
pub(crate) fn unknown_value_refusal(
    member: &str,
    value: &str,
    operations: &[String],
) -> DiffRefusal {
    let where_text = if operations.is_empty() {
        String::new()
    } else {
        format!(" on {}", operations.join(", "))
    };
    let shown = stringify_json(&JsonValue::String(value.to_owned()));

    DiffRefusal {
        code: DiffCode::UnknownValue,
        message: format!("{member} holds {shown}{where_text}, a value this diff does not know."),
        fix: UNKNOWN_VALUE_FIX.to_owned(),
        before: None,
        after: None,
        member: Some(member.to_owned()),
        operations: Some(operations.to_vec()),
    }
}

/// Refuses the diff on an open enum value the walk must act on, naming the member and the operations.
pub(crate) fn refuse_unknown_value(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    member: &str,
    value: &str,
) {
    let mut operations: Vec<String> = site
        .reaches
        .iter()
        .flat_map(|reach| reach.operations.iter().cloned())
        .collect();

    operations.sort_by(|left, right| cmp_utf16(left, right));
    operations.dedup();

    context
        .sink
        .refuse(unknown_value_refusal(member, value, &operations));
}

/// The reaches moved to position `none`, their operations kept: for rows that hold no position.
pub(crate) fn without_position(reaches: &[ChangeReach]) -> Vec<ChangeReach> {
    if reaches.is_empty() {
        return Vec::new();
    }

    let mut operations: Vec<String> = Vec::new();

    for operation in reaches.iter().flat_map(|reach| &reach.operations) {
        if !operations.contains(operation) {
            operations.push(operation.clone());
        }
    }

    vec![ChangeReach {
        position: DiffPosition::None,
        operations,
        facts: Vec::new(),
    }]
}

/// An `order` change when the names both lists keep are in another order.
pub(crate) fn compare_kept_order(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    order_case: &str,
    before: &[&str],
    after: &[&str],
) {
    let kept_before: Vec<&str> = before
        .iter()
        .copied()
        .filter(|name| after.contains(name))
        .collect();
    let kept_after: Vec<&str> = after
        .iter()
        .copied()
        .filter(|name| before.contains(name))
        .collect();

    // Joined as the TypeScript does, so names holding a NUL compare as it does.
    if kept_before.join(NAME_SEPARATOR) == kept_after.join(NAME_SEPARATOR) {
        return;
    }

    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Order, order_case, pointer.to_owned()),
    );
}

/// The callback of a keyed list for one entry.
pub(crate) type EntryCallback<'comparison, Entry> =
    Box<dyn Fn(&mut WalkContext<'_>, &str, &Entry) -> Result<(), DiffError> + 'comparison>;

/// The callback of a keyed list for an entry kept in both lists with other content.
pub(crate) type KeptEntryCallback<'comparison, Entry> =
    Box<dyn Fn(&mut WalkContext<'_>, &str, &Entry, &Entry) -> Result<(), DiffError> + 'comparison>;

/// The key of an entry in a keyed list; encoding it can fail.
pub(crate) type KeyOf<'comparison, Entry> =
    Box<dyn Fn(&Entry) -> Result<String, DiffError> + 'comparison>;

/// How the entries of a list keyed by `key_of` are compared: added, removed, or kept and changed.
pub(crate) struct KeyedListComparison<'comparison, Entry> {
    pub(crate) key_of: KeyOf<'comparison, Entry>,
    pub(crate) added: EntryCallback<'comparison, Entry>,
    pub(crate) removed: EntryCallback<'comparison, Entry>,
    pub(crate) kept: KeptEntryCallback<'comparison, Entry>,
}

/// Compares two lists entry by entry on their keys; a kept entry with other content goes to `kept`.
pub(crate) fn compare_keyed_list<Entry: Serialize>(
    context: &mut WalkContext<'_>,
    pointer: &str,
    before: &[Entry],
    after: &[Entry],
    comparison: &KeyedListComparison<'_, Entry>,
) -> Result<(), DiffError> {
    let before_keys: Vec<String> = before
        .iter()
        .map(&comparison.key_of)
        .collect::<Result<_, _>>()?;
    let after_keys: Vec<String> = after
        .iter()
        .map(&comparison.key_of)
        .collect::<Result<_, _>>()?;

    for (index, (entry, key)) in after.iter().zip(&after_keys).enumerate() {
        if !before_keys.contains(key) {
            (comparison.added)(
                context,
                &pointer_join(pointer, &[&index.to_string()]),
                entry,
            )?;
        }
    }

    for (index, (entry, key)) in before.iter().zip(&before_keys).enumerate() {
        let Some((kept, after_entry)) = after_keys
            .iter()
            .position(|candidate| candidate == key)
            .and_then(|kept| after.get(kept).map(|found| (kept, found)))
        else {
            (comparison.removed)(
                context,
                &pointer_join(pointer, &[&index.to_string()]),
                entry,
            )?;

            continue;
        };

        if !is_same_json(Some(&json_of(entry)?), Some(&json_of(after_entry)?)) {
            (comparison.kept)(
                context,
                &pointer_join(pointer, &[&kept.to_string()]),
                entry,
                after_entry,
            )?;
        }
    }

    Ok(())
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

    fn site() -> ChangeSite<'static> {
        ChangeSite {
            reaches: &NO_POSITION,
            origin: None,
        }
    }

    #[test]
    fn kept_names_in_another_order_are_an_order_change() {
        let ir = sample_ir();
        let mut walk = context(&ir);

        compare_kept_order(
            &mut walk,
            &site(),
            "/p",
            "values",
            &["a", "b", "x"],
            &["y", "a", "b"],
        );
        compare_kept_order(&mut walk, &site(), "/p", "values", &["a", "b"], &["b", "a"]);

        let kinds: Vec<(DiffKind, String)> = walk
            .sink
            .sorted_changes()
            .into_iter()
            .map(|change| (change.kind, change.case_name))
            .collect();

        assert_eq!(kinds, vec![(DiffKind::Order, "values".to_owned())]);
    }

    #[test]
    fn a_keyed_list_reports_added_removed_and_changed_entries_at_their_indexes() {
        let ir = sample_ir();
        let mut walk = context(&ir);
        let seen = RefCell::new(Vec::new());
        let comparison: KeyedListComparison<'_, (String, i64)> = KeyedListComparison {
            key_of: Box::new(|entry| Ok(entry.0.clone())),
            added: Box::new(|_context, pointer, entry| {
                seen.borrow_mut()
                    .push(format!("added {pointer} {}", entry.0));

                Ok(())
            }),
            removed: Box::new(|_context, pointer, entry| {
                seen.borrow_mut()
                    .push(format!("removed {pointer} {}", entry.0));

                Ok(())
            }),
            kept: Box::new(|_context, pointer, entry, _after| {
                seen.borrow_mut()
                    .push(format!("kept {pointer} {}", entry.0));

                Ok(())
            }),
        };
        let before = [
            ("a".to_owned(), 1),
            ("b".to_owned(), 1),
            ("c".to_owned(), 1),
        ];
        let after = [
            ("c".to_owned(), 1),
            ("new".to_owned(), 1),
            ("b".to_owned(), 2),
        ];

        compare_keyed_list(&mut walk, "/list", &before, &after, &comparison)
            .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(
            seen.borrow().clone(),
            vec!["added /list/1 new", "removed /list/0 a", "kept /list/2 b"]
        );
    }

    #[test]
    fn reaches_without_position_keep_each_operation_once() {
        let reach = |position, operations: &[&str]| ChangeReach {
            position,
            operations: operations.iter().map(|id| (*id).to_owned()).collect(),
            facts: Vec::new(),
        };
        let moved = without_position(&[
            reach(DiffPosition::Input, &["b", "a"]),
            reach(DiffPosition::Output, &["a", "c"]),
        ]);

        assert_eq!(moved, vec![reach(DiffPosition::None, &["b", "a", "c"])]);
        assert_eq!(without_position(&[]), Vec::new());
    }
}
