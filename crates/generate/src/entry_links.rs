//! The links between target entries: their order, and the checks that each link names an entry
//! whose target provides it, whose consumer takes it and whose apis pair.

use seampact_cli_config::{
    CliProblem, Problems, TargetEntrySettings, entry_where, located_problem,
};
use seampact_js::js_key_order;
use seampact_target::LinkKind;

use crate::PlannedApi;
use crate::link_set::is_link_kind;
use crate::planned_entry::PlannedEntry;

/// The links of `entry` as kind and provider id, in the order JavaScript lists object keys.
#[must_use]
pub fn links_of(entry: &TargetEntrySettings) -> Vec<(&str, &str)> {
    js_key_order(
        entry
            .link
            .iter()
            .map(|(kind, provider)| (kind.as_str(), provider.as_str())),
    )
    .collect()
}

/// Where a link problem is: the consumer, its provider and, for an api, the api.
#[must_use]
pub fn link_where(consumer_id: &str, provider_id: &str, api: Option<&str>) -> String {
    let api_text = api.map_or_else(String::new, |api| format!(", api '{api}'"));

    format!("entry '{consumer_id}' linked to '{provider_id}'{api_text}")
}

/// One problem for each link that names an id no entry has.
#[must_use]
pub fn unknown_link_entry_problems(entries: &[&TargetEntrySettings]) -> Vec<CliProblem> {
    let mut problems = Vec::new();

    for entry in entries {
        for (kind, provider_id) in links_of(entry) {
            if entries.iter().any(|each| each.id == provider_id) {
                continue;
            }

            problems.push(located_problem(
                "link.entry.unknown",
                format!(
                    "The '{kind}' link names '{provider_id}', and no target entry has that id."
                ),
                "Name the id of the target entry that provides the link.",
                link_where(&entry.id, provider_id, None),
            ));
        }
    }

    problems
}

/// Lists `entries` so each comes after the providers it links.
///
/// # Errors
///
/// [`Problems`] naming the first link cycle.
pub fn order_entries<'entries>(
    entries: &[&'entries TargetEntrySettings],
) -> Result<Vec<&'entries TargetEntrySettings>, Problems> {
    let mut walk = OrderWalk {
        entries,
        ordered: Vec::new(),
        visiting: Vec::new(),
    };

    for entry in entries {
        if let Some(problem) = walk.visit(entry) {
            return Err(problem.into());
        }
    }

    Ok(walk.ordered)
}

struct OrderWalk<'walk, 'entries> {
    entries: &'walk [&'entries TargetEntrySettings],
    ordered: Vec<&'entries TargetEntrySettings>,
    visiting: Vec<&'entries str>,
}

impl<'entries> OrderWalk<'_, 'entries> {
    fn visit(&mut self, entry: &'entries TargetEntrySettings) -> Option<CliProblem> {
        if self.ordered.iter().any(|done| done.id == entry.id) {
            return None;
        }

        if let Some(cycle_start) = self.visiting.iter().position(|id| *id == entry.id) {
            return Some(cycle_problem(&self.visiting, cycle_start, &entry.id));
        }

        self.visiting.push(&entry.id);

        for (_, provider_id) in links_of(entry) {
            let provider = self.entries.iter().find(|each| each.id == provider_id);
            let problem = provider.and_then(|provider| self.visit(provider));

            if problem.is_some() {
                return problem;
            }
        }

        self.visiting.pop();
        self.ordered.push(entry);

        None
    }
}

fn cycle_problem(visiting: &[&str], cycle_start: usize, entry_id: &str) -> CliProblem {
    let mut cycle: Vec<&str> = visiting.iter().skip(cycle_start).copied().collect();

    cycle.push(entry_id);

    let path: Vec<String> = cycle.iter().map(|id| format!("'{id}'")).collect();

    located_problem(
        "link.cycle",
        format!("The links form a cycle: {}.", path.join(" -> ")),
        "Remove one of these links: a provider cannot consume what its consumer generates.",
        entry_where(entry_id, None),
    )
}

fn kinds_text(kinds: impl Iterator<Item = LinkKind>) -> String {
    let names: Vec<&str> = kinds.map(LinkKind::as_str).collect();

    if names.is_empty() {
        "nothing".to_owned()
    } else {
        names.join(", ")
    }
}

/// One problem for each link whose provider's target does not provide its kind.
#[must_use]
pub fn unprovided_kind_problems(planned: &[PlannedEntry]) -> Vec<CliProblem> {
    let mut problems = Vec::new();

    for consumer in planned {
        let entry = &consumer.settings;

        for (kind, provider_id) in links_of(entry) {
            let Some(provider) = provider_among(planned, provider_id) else {
                continue;
            };
            let metadata = provider.target.metadata();

            if is_link_kind(kind).is_some_and(|known| metadata.provides.of(known).is_some()) {
                continue;
            }

            let offered = kinds_text(metadata.provides.kinds().into_iter());

            problems.push(located_problem(
                "link.kind.not-provided",
                format!(
                    "'{provider_id}' ({}) does not provide '{kind}'; it provides {offered}.",
                    metadata.id
                ),
                &format!("Link an entry whose target provides '{kind}'."),
                link_where(&entry.id, provider_id, None),
            ));
        }
    }

    problems
}

/// One problem for each link of a kind the consumer's target does not consume.
#[must_use]
pub fn unconsumed_kind_problems(planned: &[PlannedEntry]) -> Vec<CliProblem> {
    let mut problems = Vec::new();

    for consumer in planned {
        let entry = &consumer.settings;
        let metadata = consumer.target.metadata();

        for (kind, provider_id) in links_of(entry) {
            if is_link_kind(kind).is_some_and(|known| metadata.consumes.of(known).is_some()) {
                continue;
            }

            let consumed = kinds_text(
                LinkKind::ALL
                    .into_iter()
                    .filter(|known| metadata.consumes.of(*known).is_some()),
            );

            problems.push(located_problem(
                "link.kind.not-consumed",
                format!(
                    "'{}' ({}) does not consume '{kind}', linked to '{provider_id}'; it consumes {consumed}.",
                    entry.id, metadata.id
                ),
                &format!(
                    "Remove the '{kind}' link of '{}', or use a target that consumes '{kind}'.",
                    entry.id
                ),
                link_where(&entry.id, provider_id, None),
            ));
        }
    }

    problems
}

/// One problem for each api a consumer generates that its provider does not pair or keeps fewer
/// operations of.
#[must_use]
pub fn pairing_problems(planned: &[PlannedEntry]) -> Vec<CliProblem> {
    let mut problems = Vec::new();

    for consumer in planned {
        for (_, provider_id) in links_of(&consumer.settings) {
            let Some(provider) = provider_among(planned, provider_id) else {
                continue;
            };

            for consumer_api in &consumer.apis {
                problems.extend(api_pair_problems(consumer, provider, consumer_api));
            }
        }
    }

    problems
}

fn provider_among<'planned>(
    planned: &'planned [PlannedEntry],
    provider_id: &str,
) -> Option<&'planned PlannedEntry> {
    planned.iter().find(|each| each.settings.id == provider_id)
}

/// The api of `provider` that pairs `consumer_api`: the same api of the same source.
#[must_use]
pub fn paired_api<'provider>(
    provider: &'provider PlannedEntry,
    consumer_api: &PlannedApi,
) -> Option<&'provider PlannedApi> {
    provider
        .apis
        .iter()
        .find(|each| each.api == consumer_api.api && each.source == consumer_api.source)
}

fn api_pair_problems(
    consumer: &PlannedEntry,
    provider: &PlannedEntry,
    consumer_api: &PlannedApi,
) -> Vec<CliProblem> {
    let consumer_id = &consumer.settings.id;
    let provider_id = &provider.settings.id;
    let api = &consumer_api.api;
    let location = link_where(consumer_id, provider_id, Some(api));

    let Some(provider_api) = paired_api(provider, consumer_api) else {
        return vec![located_problem(
            "link.apis.unpaired",
            format!(
                "'{provider_id}' does not generate the api '{api}' that '{consumer_id}' generates."
            ),
            &format!(
                "Add '{api}' to the apis of '{provider_id}', or remove it from '{consumer_id}'."
            ),
            location,
        )];
    };

    let missing: Vec<&str> = consumer_api
        .ir
        .operations
        .iter()
        .map(|operation| operation.id.as_str())
        .filter(|id| {
            !provider_api
                .ir
                .operations
                .iter()
                .any(|operation| operation.id.as_str() == *id)
        })
        .collect();

    if missing.is_empty() {
        return Vec::new();
    }

    vec![located_problem(
        "link.operations.missing",
        format!(
            "'{provider_id}' leaves out operations '{consumer_id}' keeps: {}.",
            missing.join(", ")
        ),
        &format!(
            "Keep these operations in the `document` and `operations` of '{provider_id}', or drop them from '{consumer_id}'."
        ),
        location,
    )]
}
