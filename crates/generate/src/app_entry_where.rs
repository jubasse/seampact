//! The location of a target entry in a run that reads one app or several.

use seampact_cli_config::entry_where;

/// The location of a target entry under `app` when the run reads several apps.
#[must_use]
pub fn app_entry_where(app: Option<&str>, entry_id: &str, api: Option<&str>) -> String {
    let location = entry_where(entry_id, api);

    match app {
        Some(app) => format!("app '{app}', {location}"),
        None => location,
    }
}
