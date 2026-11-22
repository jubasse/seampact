//! Collects the walk's changes: each raw change is classified once per reach, changes of one member
//! at one position with one outcome are merged, and the result sorts the same way every time.

use std::cmp::Ordering;
use std::collections::HashSet;

use indexmap::IndexMap;
use seampact_diff_table::{
    DiffBreak, DiffCause, DiffChange, DiffClassification, DiffFact, DiffKind, DiffPosition,
    DiffRefusal, classify_cell,
};
use seampact_ir::Origin;
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use crate::walk_json::scalar_value;

/// A position and the operations that reach a member there, with the facts true for that reach.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ChangeReach {
    pub(crate) position: DiffPosition,
    pub(crate) operations: Vec<String>,
    pub(crate) facts: Vec<DiffFact>,
}

/// The part of an element's `Origin` the pack cause reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ElementOrigin {
    pub(crate) layer: String,
}

impl From<&Origin> for ElementOrigin {
    fn from(origin: &Origin) -> Self {
        Self {
            layer: origin.layer.to_string(),
        }
    }
}

/// A change before it is classified.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RawChange {
    pub(crate) kind: DiffKind,
    pub(crate) case_name: String,
    pub(crate) pointer: String,
    pub(crate) before: Option<JsonValue>,
    pub(crate) after: Option<JsonValue>,
    /// The changed element's origin (in `after`, in `before` for a removal), read for the pack cause.
    pub(crate) origin: Option<ElementOrigin>,
    pub(crate) facts: Vec<DiffFact>,
}

impl RawChange {
    /// A change with no values, facts or origin; the site's origin is set when it is emitted.
    pub(crate) fn new(kind: DiffKind, case_name: &str, pointer: String) -> Self {
        Self {
            kind,
            case_name: case_name.to_owned(),
            pointer,
            before: None,
            after: None,
            origin: None,
            facts: Vec::new(),
        }
    }

    /// The change with the value on each side.
    pub(crate) fn between(self, before: Option<JsonValue>, after: Option<JsonValue>) -> Self {
        Self {
            before,
            after,
            ..self
        }
    }

    /// The change with the facts that hold for it.
    pub(crate) fn with_facts(self, facts: Vec<DiffFact>) -> Self {
        Self { facts, ..self }
    }
}

/// The prefix of an `Origin.layer` that names a pack.
const PACK_LAYER_PREFIX: &str = "pack:";

/// The sides a change with no table row breaks, in report order.
const BREAK_ORDER: [DiffBreak; 2] = [DiffBreak::Clients, DiffBreak::Servers];

/// The one reach of a change that no operation reaches.
pub(crate) static NO_POSITION: [ChangeReach; 1] = [ChangeReach {
    position: DiffPosition::None,
    operations: Vec::new(),
    facts: Vec::new(),
}];

/// The changes of one walk, merged by member, position and outcome.
#[derive(Debug)]
pub(crate) struct ChangeSink {
    changed_packs: HashSet<String>,
    changes: IndexMap<String, DiffChange>,
    refusals: Vec<DiffRefusal>,
}

impl ChangeSink {
    /// A sink that names a pack as a cause only when it is in `changed_packs`.
    pub(crate) fn new(changed_packs: HashSet<String>) -> Self {
        Self {
            changed_packs,
            changes: IndexMap::new(),
            refusals: Vec::new(),
        }
    }

    /// Classifies `raw` at each of `reaches` and records it.
    pub(crate) fn emit(&mut self, raw: &RawChange, reaches: &[ChangeReach]) {
        for reach in reaches {
            self.emit_at(raw, reach);
        }
    }

    /// Records a refusal.
    pub(crate) fn refuse(&mut self, refusal: DiffRefusal) {
        self.refusals.push(refusal);
    }

    /// The refusals recorded so far.
    pub(crate) fn refusals(&self) -> &[DiffRefusal] {
        &self.refusals
    }

    /// The changes in report order.
    pub(crate) fn sorted_changes(&self) -> Vec<DiffChange> {
        let mut changes: Vec<DiffChange> = self.changes.values().cloned().collect();

        changes.sort_by(compare_changes);

        changes
    }

    fn emit_at(&mut self, raw: &RawChange, reach: &ChangeReach) {
        let facts: HashSet<DiffFact> = reach.facts.iter().chain(&raw.facts).copied().collect();
        let outcome = classify_cell(raw.kind, &raw.case_name, reach.position, &facts);
        let (kind, case_name) = match outcome {
            Some(_) => (raw.kind, raw.case_name.clone()),
            None => (
                DiffKind::Unclassified,
                format!("{}.{}", raw.kind.as_str(), raw.case_name),
            ),
        };
        let (breaks, classification) = match outcome {
            Some(found) => (found.breaks, found.classification),
            None => (BREAK_ORDER.to_vec(), DiffClassification::Breaking),
        };
        // Reaches whose facts resolve the cell differently stay apart, so a break names only the operations it breaks.
        let mut key_parts = vec![
            kind.as_str(),
            &case_name,
            &raw.pointer,
            reach.position.as_str(),
            classification.as_str(),
        ];

        key_parts.extend(breaks.iter().map(|side| side.as_str()));

        let key = key_parts.join("\0");

        if let Some(existing) = self.changes.get_mut(&key) {
            let merged: Vec<&String> = existing
                .operations
                .iter()
                .chain(&reach.operations)
                .collect();

            existing.operations = sorted_unique(merged);

            return;
        }

        let change = DiffChange {
            kind,
            case_name,
            pointer: raw.pointer.clone(),
            position: reach.position,
            operations: sorted_unique(reach.operations.iter().collect()),
            breaks,
            classification,
            before: scalar_value(raw.before.as_ref()),
            after: scalar_value(raw.after.as_ref()),
            cause: self.cause_pack(raw.origin.as_ref()),
            exemption: None,
        };

        self.changes.insert(key, change);
    }

    fn cause_pack(&self, origin: Option<&ElementOrigin>) -> Option<DiffCause> {
        let pack = origin?.layer.strip_prefix(PACK_LAYER_PREFIX)?;

        self.changed_packs.contains(pack).then(|| DiffCause {
            pack: pack.to_owned(),
        })
    }
}

fn sorted_unique(operations: Vec<&String>) -> Vec<String> {
    let mut sorted: Vec<String> = operations.into_iter().cloned().collect();

    sorted.sort_by(|left, right| cmp_utf16(left, right));
    sorted.dedup();

    sorted
}

fn compare_changes(left: &DiffChange, right: &DiffChange) -> Ordering {
    let first_operation =
        |change: &DiffChange| change.operations.first().cloned().unwrap_or_default();
    let breaks_text = |change: &DiffChange| {
        let names: Vec<&str> = change.breaks.iter().map(|side| side.as_str()).collect();

        names.join(",")
    };

    cmp_utf16(&first_operation(left), &first_operation(right))
        .then_with(|| cmp_utf16(&left.pointer, &right.pointer))
        .then_with(|| cmp_utf16(left.kind.as_str(), right.kind.as_str()))
        .then_with(|| cmp_utf16(&left.case_name, &right.case_name))
        .then_with(|| cmp_utf16(left.position.as_str(), right.position.as_str()))
        .then_with(|| cmp_utf16(&breaks_text(left), &breaks_text(right)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn removed_optional_property() -> RawChange {
        RawChange {
            kind: DiffKind::PropertyRemoved,
            case_name: "optional".to_owned(),
            pointer: "/schemas/Note/properties/1".to_owned(),
            before: None,
            after: None,
            origin: None,
            facts: Vec::new(),
        }
    }

    fn input_reach(operation: &str, facts: Vec<DiffFact>) -> ChangeReach {
        ChangeReach {
            position: DiffPosition::Input,
            operations: vec![operation.to_owned()],
            facts,
        }
    }

    #[test]
    fn reaches_whose_facts_resolve_differently_stay_apart() {
        let mut sink = ChangeSink::new(HashSet::new());
        let strict = vec![DiffFact::AfterRefusesUnknownKeys];

        sink.emit(
            &removed_optional_property(),
            &[
                input_reach("strictNote", strict.clone()),
                input_reach("lenientNote", Vec::new()),
                input_reach("otherStrictNote", strict),
            ],
        );

        let outcomes: Vec<(Vec<String>, Vec<DiffBreak>)> = sink
            .sorted_changes()
            .into_iter()
            .map(|change| (change.operations, change.breaks))
            .collect();

        assert_eq!(
            outcomes,
            vec![
                (vec!["lenientNote".to_owned()], Vec::new()),
                (
                    vec!["otherStrictNote".to_owned(), "strictNote".to_owned()],
                    vec![DiffBreak::Clients]
                ),
            ]
        );
    }

    #[test]
    fn operations_sort_by_utf16_code_unit() {
        let mut sink = ChangeSink::new(HashSet::new());
        let astral = "\u{10000}op";
        let high_bmp = "\u{FF5E}op";

        sink.emit(
            &removed_optional_property(),
            &[
                input_reach(high_bmp, Vec::new()),
                input_reach(astral, Vec::new()),
            ],
        );

        let operations: Vec<Vec<String>> = sink
            .sorted_changes()
            .into_iter()
            .map(|change| change.operations)
            .collect();

        assert_eq!(
            operations,
            vec![vec![astral.to_owned(), high_bmp.to_owned()]]
        );
    }

    #[test]
    fn changes_sort_by_utf16_pointer() {
        let mut sink = ChangeSink::new(HashSet::new());

        for pointer in ["/\u{FF5E}", "/\u{10000}"] {
            let mut raw = removed_optional_property();

            raw.pointer = pointer.to_owned();
            sink.emit(&raw, &NO_POSITION);
        }

        let pointers: Vec<String> = sink
            .sorted_changes()
            .into_iter()
            .map(|change| change.pointer)
            .collect();

        assert_eq!(
            pointers,
            vec!["/\u{10000}".to_owned(), "/\u{FF5E}".to_owned()]
        );
    }

    #[test]
    fn a_pack_layer_is_a_cause_only_when_the_pack_changed() {
        let mut sink = ChangeSink::new(HashSet::from(["auth".to_owned()]));

        for layer in ["pack:auth", "pack:other", "api"] {
            let mut raw = removed_optional_property();

            raw.pointer = format!("/{layer}");
            raw.origin = Some(ElementOrigin {
                layer: layer.to_owned(),
            });
            sink.emit(&raw, &NO_POSITION);
        }

        let causes: Vec<(String, Option<String>)> = sink
            .sorted_changes()
            .into_iter()
            .map(|change| (change.pointer, change.cause.map(|cause| cause.pack)))
            .collect();

        assert_eq!(
            causes,
            vec![
                ("/api".to_owned(), None),
                ("/pack:auth".to_owned(), Some("auth".to_owned())),
                ("/pack:other".to_owned(), None),
            ]
        );
    }
}
