//! The import specifier style each provider entry is asked for by itself and by its consumers.

use indexmap::IndexMap;
use seampact_cli_config::{CliProblem, Problems, entry_where, located_problem};
use seampact_target::ImportSpecifierStyle;

use crate::entry_links::links_of;
use crate::planned_entry::PlannedEntry;
use crate::stop::Stop;

/// The entries that asked each provider for a style, in the order they asked.
pub(crate) type AskedBy = IndexMap<String, IndexMap<ImportSpecifierStyle, Vec<String>>>;

/// The style each linked entry generates in: the one its own target and its consumers agree on,
/// or one problem for each entry they disagree on.
///
/// # Errors
///
/// [`Stop::Refused`] with one problem per entry the asks disagree on.
pub fn import_specifier_styles(
    planned: &[PlannedEntry],
) -> Result<IndexMap<String, ImportSpecifierStyle>, Stop> {
    let mut asked_by = AskedBy::new();

    for each in planned {
        let entry = &each.settings;
        let own = each.target.metadata().import_specifiers;

        if let Some(own) = own {
            record_ask(&mut asked_by, &entry.id, own, &entry.id);
        }

        for (_, provider_id) in links_of(entry) {
            record_ask(
                &mut asked_by,
                provider_id,
                own.unwrap_or_default(),
                &entry.id,
            );
        }
    }

    let mut styles = IndexMap::new();
    let mut problems = Vec::new();

    for (entry_id, asks) in &asked_by {
        let mut asked = asks.keys();

        match (asked.next(), asked.next()) {
            (Some(first), None) => {
                styles.insert(entry_id.clone(), *first);
            }
            _ => problems.push(mixed_styles_problem(entry_id, asks)),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(styles)
}

fn record_ask(asked_by: &mut AskedBy, provider_id: &str, style: ImportSpecifierStyle, asker: &str) {
    asked_by
        .entry(provider_id.to_owned())
        .or_default()
        .entry(style)
        .or_default()
        .push(asker.to_owned());
}

fn mixed_styles_problem(
    entry_id: &str,
    asks: &IndexMap<ImportSpecifierStyle, Vec<String>>,
) -> CliProblem {
    let described: Vec<String> = asks
        .iter()
        .map(|(style, askers)| {
            let ids: Vec<String> = askers.iter().map(|id| format!("'{id}'")).collect();

            format!(
                "{} import with '{}' specifiers",
                ids.join(", "),
                style.as_str()
            )
        })
        .collect();

    located_problem(
        "link.importSpecifiers.mixed",
        format!(
            "The entry '{entry_id}' is linked from entries that import its files differently: {}.",
            described.join("; ")
        ),
        &format!(
            "Give each group of entries its own '{entry_id}' entry, with its own 'out', and link each group to its own."
        ),
        entry_where(entry_id, None),
    )
}
