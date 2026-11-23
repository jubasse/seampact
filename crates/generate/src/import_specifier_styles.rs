//! The import specifier style each provider entry is asked for by itself and by its consumers.

use indexmap::IndexMap;
use seampact_cli_config::{CliProblem, Problems};
use seampact_target::ImportSpecifierStyle;

use crate::GenerateError;
use crate::entry_links::links_of;
use crate::not_ported::not_ported_yet;
use crate::planned_entry::PlannedEntry;
use crate::stop::Stop;

/// The entries that asked each provider for a style, in the order they asked.
pub(crate) type AskedBy = IndexMap<String, IndexMap<ImportSpecifierStyle, Vec<String>>>;

/// The style each linked entry generates in: the one its own target and its consumers agree on,
/// or one problem for each entry they disagree on.
///
/// # Errors
///
/// [`Stop::Refused`] with one problem per entry the asks disagree on; [`Stop::Failed`] with
/// [`GenerateError::NotPortedYet`] until `recordAsk` and `mixedStylesProblem` are ported.
pub fn import_specifier_styles(
    planned: &[PlannedEntry],
) -> Result<IndexMap<String, ImportSpecifierStyle>, Stop> {
    let mut asked_by = AskedBy::new();

    for each in planned {
        let entry = &each.settings;
        let own = each.target.metadata().import_specifiers;

        if let Some(own) = own {
            record_ask(&mut asked_by, &entry.id, own, &entry.id)?;
        }

        for (_, provider_id) in links_of(entry) {
            record_ask(
                &mut asked_by,
                provider_id,
                own.unwrap_or_default(),
                &entry.id,
            )?;
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
            _ => problems.push(mixed_styles_problem(entry_id, asks)?),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(styles)
}

fn record_ask(
    _asked_by: &mut AskedBy,
    _provider_id: &str,
    _style: ImportSpecifierStyle,
    _asker: &str,
) -> Result<(), GenerateError> {
    Err(not_ported_yet("recordAsk"))
}

fn mixed_styles_problem(
    _entry_id: &str,
    _asks: &IndexMap<ImportSpecifierStyle, Vec<String>>,
) -> Result<CliProblem, GenerateError> {
    Err(not_ported_yet("mixedStylesProblem"))
}
