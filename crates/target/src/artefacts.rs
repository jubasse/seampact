//! The artefacts a target declares and the set an entry switches on.

use serde::Serialize;

use crate::{Refusal, refusal_code};

/// Whether an artefact is on when the app config leaves it alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArtefactDefault {
    /// On unless switched off.
    On,
    /// Off unless switched on.
    Off,
}

/// What happens to an artefact switched on whose needed artefact is off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MissingNeed {
    /// The entry is refused.
    Refuse,
    /// The artefact is left off, as `leftOffWithoutNeeds`.
    LeaveOff,
}

/// One artefact a target can write, switched by the app config's `artefacts` entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ArtefactDeclaration {
    /// The id an app config switches, `^[a-z][A-Za-z0-9]*$`.
    pub id: &'static str,
    /// Its state when the app config leaves it alone.
    pub default: ArtefactDefault,
    /// The artefacts it needs on.
    pub needs: &'static [&'static str],
    /// What happens when a needed artefact is off.
    pub missing_need: MissingNeed,
}

/// The artefact ids an entry switches on, in the order the run planning selected them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct ArtefactSet {
    ids: Vec<String>,
}

impl ArtefactSet {
    /// No artefact.
    pub const NONE: Self = Self { ids: Vec::new() };

    /// The set of `ids`, each kept once, in first-seen order.
    #[must_use]
    pub fn new(ids: impl IntoIterator<Item = String>) -> Self {
        let mut set = Self::NONE;

        for id in ids {
            if !set.contains(&id) {
                set.ids.push(id);
            }
        }

        set
    }

    /// True when `id` is on.
    #[must_use]
    pub fn contains(&self, id: &str) -> bool {
        self.ids.iter().any(|on| on == id)
    }

    /// The ids, in selection order.
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.ids.iter().map(String::as_str)
    }

    /// The ids in UTF-16 order, as the TypeScript's `[...set].sort()`.
    #[must_use]
    pub fn sorted(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = self.iter().collect();

        ids.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));

        ids
    }
}

impl Serialize for ArtefactSet {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(self.iter())
    }
}

/// One `artefact.unknown` refusal per requested id the target does not declare.
#[must_use]
pub fn refuse_undeclared_artefacts(
    requested: &ArtefactSet,
    declared: &[ArtefactDeclaration],
) -> Vec<Refusal> {
    let declared_ids: Vec<&str> = declared.iter().map(|artefact| artefact.id).collect();
    let listed = declared_ids.join(", ");

    requested
        .iter()
        .filter(|id| !declared_ids.contains(id))
        .map(|id| {
            Refusal::new(
                refusal_code::ARTEFACT_UNKNOWN,
                format!("The artefact '{id}' is not one this target declares ({listed})."),
                "Remove it from the target's `artefacts` entry, or use one of the declared ids.",
            )
        })
        .collect()
}

/// The problems of a target's artefact declarations: ids an app config cannot switch, repeats,
/// needs of itself or of an undeclared id, and an artefact on by default that needs one off by
/// default, which would refuse every app config that leaves both alone. Empty for a valid list;
/// the registry test runs it over every generator.
#[must_use]
pub fn artefact_declaration_problems(declared: &[ArtefactDeclaration]) -> Vec<String> {
    declared
        .iter()
        .enumerate()
        .flat_map(|(index, artefact)| {
            let earlier = declared.get(..index).unwrap_or_default();

            problems_of(artefact, earlier, declared)
        })
        .collect()
}

fn problems_of(
    artefact: &ArtefactDeclaration,
    earlier: &[ArtefactDeclaration],
    declared: &[ArtefactDeclaration],
) -> Vec<String> {
    let id = artefact.id;
    let mut problems = Vec::new();

    if !is_switchable_id(id) {
        problems.push(format!(
            "'{id}' is no id an app config can switch ({ARTEFACT_ID_PATTERN})."
        ));
    }

    if earlier.iter().any(|other| other.id == id) {
        problems.push(format!("'{id}' is declared twice."));
    }

    for need in artefact.needs {
        let needed = declared.iter().find(|other| other.id == *need);

        if *need == id {
            problems.push(format!("'{id}' needs itself."));
        } else if let Some(needed) = needed {
            if artefact.default == ArtefactDefault::On && needed.default == ArtefactDefault::Off {
                problems.push(format!(
                    "'{id}' is on by default and needs '{need}', which is off by default."
                ));
            }
        } else {
            problems.push(format!("'{id}' needs '{need}', which is not declared."));
        }
    }

    problems
}

/// The pattern of an artefact id, `spec/src/config/app-config.ts#ARTEFACT_ID_PATTERN`.
const ARTEFACT_ID_PATTERN: &str = "^[a-z][A-Za-z0-9]*$";

fn is_switchable_id(id: &str) -> bool {
    let mut characters = id.chars();

    characters
        .next()
        .is_some_and(|first| first.is_ascii_lowercase())
        && characters.all(|rest| rest.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn artefact(
        id: &'static str,
        default: ArtefactDefault,
        needs: &'static [&'static str],
    ) -> ArtefactDeclaration {
        ArtefactDeclaration {
            id,
            default,
            needs,
            missing_need: MissingNeed::Refuse,
        }
    }

    #[test]
    fn names_every_declaration_problem() {
        let declared = [
            artefact("routes", ArtefactDefault::On, &["docs"]),
            artefact("docs", ArtefactDefault::Off, &["docs", "missing"]),
            artefact("routes", ArtefactDefault::Off, &[]),
            artefact("Bad-id", ArtefactDefault::Off, &[]),
        ];

        assert_eq!(
            artefact_declaration_problems(&declared),
            [
                "'routes' is on by default and needs 'docs', which is off by default.",
                "'docs' needs itself.",
                "'docs' needs 'missing', which is not declared.",
                "'routes' is declared twice.",
                "'Bad-id' is no id an app config can switch (^[a-z][A-Za-z0-9]*$).",
            ]
        );
    }
}
