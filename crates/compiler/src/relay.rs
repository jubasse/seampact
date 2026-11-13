//! What the orchestrator asks of the relay order: its check, and the skip of an api that relays to
//! a stopped one.

use std::collections::HashSet;
use std::hash::BuildHasher;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;

use crate::stages::RelayOrder;

/// Checks that the order lists every workspace api once and no other name.
///
/// # Errors
///
/// An [`InternalError`] when it does not: the relay stage is wrong, whatever the contract says.
pub fn check_relay_order(relay: &RelayOrder, workspace_apis: &[&str]) -> Result<(), InternalError> {
    let named: HashSet<&str> = relay.order.iter().map(String::as_str).collect();
    let complete = relay.order.len() == workspace_apis.len()
        && named.len() == workspace_apis.len()
        && workspace_apis.iter().all(|api| named.contains(api));

    if complete {
        return Ok(());
    }

    Err(InternalError::new(
        "the relay order must list every workspace api once, and no other name",
    ))
}

/// Whether `api` relays to a stopped api, directly or through other workspace apis.
#[must_use]
pub fn relays_to_stopped<Hasher: BuildHasher>(
    api: &str,
    relays_to: &IndexMap<String, Vec<String>>,
    stopped: &HashSet<String, Hasher>,
) -> bool {
    let mut seen: HashSet<&str> = HashSet::new();

    reaches_stopped(api, relays_to, stopped, &mut seen)
}

fn reaches_stopped<'relay, Hasher: BuildHasher>(
    api: &str,
    relays_to: &'relay IndexMap<String, Vec<String>>,
    stopped: &HashSet<String, Hasher>,
    seen: &mut HashSet<&'relay str>,
) -> bool {
    let Some(targets) = relays_to.get(api) else {
        return false;
    };

    for target in targets {
        if stopped.contains(target) {
            return true;
        }

        if !seen.insert(target) {
            continue;
        }

        if reaches_stopped(target, relays_to, stopped, seen) {
            return true;
        }
    }

    false
}
