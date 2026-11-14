//! The relay order of a workspace (ADR 0006 section 1): each api compiles after every workspace api
//! its relay routes name, in workspace order where no relay decides, and relays that form a cycle
//! are refused. A relay to an import or to a name that is no api is not ordered: `tree.nodes`
//! checks the name. Also what the orchestrator asks of it: its check, and the skip of an api that
//! relays to a stopped one.

use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;

use indexmap::{IndexMap, IndexSet};
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_json::JsonValue;
use seampact_pass_link::diagnostic_origin_of;
use seampact_pipeline::{TreeNodeKind, pipeline_origin, pipeline_tree_nodes, pointer_below};

use crate::stages::RelayOrder;

const WORKSPACE_RELAY_CYCLE_RULE: &str = "seampact/workspace/relay-cycle";

/// The rule id a relay cycle is reported under.
pub(crate) const RELAY_CYCLE_RULE_ID: RuleId = RuleId::from_static(WORKSPACE_RELAY_CYCLE_RULE);

const RELAYS_MEMBER: &str = "relays";

/// A relay route of an api that names a workspace api, located at its `relays` member.
#[derive(Debug, Clone)]
struct WorkspaceRelayRoute {
    target: String,
    origin: DiagnosticOrigin,
}

// `relays: <api>.<operationId>`: the api is the text before the first dot.
fn relay_target_api(relays: Option<&JsonValue>) -> Option<&str> {
    let JsonValue::String(text) = relays? else {
        return None;
    };

    text.split_once('.')
        .map(|(api, _)| api)
        .filter(|api| !api.is_empty())
}

fn workspace_relay_routes(
    raw: &RawApi,
    workspace_apis: &HashSet<&str>,
) -> Result<Vec<WorkspaceRelayRoute>, InternalError> {
    let mut routes = Vec::new();

    for (_, node) in pipeline_tree_nodes(raw)?.iter() {
        if node.kind != TreeNodeKind::Relay {
            continue;
        }

        let Some(target) = relay_target_api(node.settings.get(RELAYS_MEMBER)) else {
            continue;
        };

        if !workspace_apis.contains(target) {
            continue;
        }

        let pointer = pointer_below(&node.pointer, &[RELAYS_MEMBER]);
        let origin = pipeline_origin(raw, &pointer)
            .as_ref()
            .and_then(diagnostic_origin_of);
        let Some(origin) = origin else {
            return Err(InternalError::new(format!(
                "relay order: api '{}' has no source location for {pointer}",
                raw.name
            )));
        };

        routes.push(WorkspaceRelayRoute {
            target: target.to_owned(),
            origin,
        });
    }

    Ok(routes)
}

/// The strongly connected components of the relay graph, each listed in workspace order, in the
/// order Tarjan completes them.
#[derive(Debug, Default)]
struct RelayComponents {
    members: Vec<Vec<String>>,
    component_of: HashMap<String, usize>,
}

impl RelayComponents {
    fn members_of(&self, api: &str) -> Option<&[String]> {
        let component = self.component_of.get(api)?;

        self.members.get(*component).map(Vec::as_slice)
    }
}

struct Tarjan<'graph> {
    apis: &'graph [String],
    relays_to: &'graph IndexMap<String, Vec<String>>,
    index: HashMap<String, usize>,
    low_link: HashMap<String, usize>,
    stack: Vec<String>,
    on_stack: HashSet<String>,
    components: RelayComponents,
}

impl Tarjan<'_> {
    fn index_of(&self, api: &str) -> Result<usize, InternalError> {
        self.index
            .get(api)
            .copied()
            .ok_or_else(|| InternalError::new(format!("relay order: api '{api}' has no index")))
    }

    fn low_link_of(&self, api: &str) -> Result<usize, InternalError> {
        self.low_link
            .get(api)
            .copied()
            .ok_or_else(|| InternalError::new(format!("relay order: api '{api}' has no low link")))
    }

    fn connect(&mut self, api: &str) -> Result<(), InternalError> {
        let api_index = self.index.len();

        self.index.insert(api.to_owned(), api_index);
        self.low_link.insert(api.to_owned(), api_index);
        self.stack.push(api.to_owned());
        self.on_stack.insert(api.to_owned());

        let relays_to = self.relays_to;

        for target in relays_to.get(api).into_iter().flatten() {
            if !self.index.contains_key(target) {
                self.connect(target)?;

                let lowest = self.low_link_of(api)?.min(self.low_link_of(target)?);

                self.low_link.insert(api.to_owned(), lowest);
            } else if self.on_stack.contains(target) {
                let lowest = self.low_link_of(api)?.min(self.index_of(target)?);

                self.low_link.insert(api.to_owned(), lowest);
            }
        }

        if self.low_link_of(api)? != self.index_of(api)? {
            return Ok(());
        }

        self.complete_component(api);

        Ok(())
    }

    fn complete_component(&mut self, api: &str) {
        let mut members: Vec<String> = Vec::new();

        while let Some(member) = self.stack.pop() {
            self.on_stack.remove(&member);

            let is_root = member == api;

            members.push(member);

            if is_root {
                break;
            }
        }

        members.sort_by_key(|member| self.apis.iter().position(|candidate| candidate == member));

        let component = self.components.members.len();

        for member in &members {
            self.components
                .component_of
                .insert(member.clone(), component);
        }

        self.components.members.push(members);
    }
}

// The strongly connected components of the relay graph (Tarjan), each listed in workspace order.
fn relay_components(
    apis: &[String],
    relays_to: &IndexMap<String, Vec<String>>,
) -> Result<RelayComponents, InternalError> {
    let mut tarjan = Tarjan {
        apis,
        relays_to,
        index: HashMap::new(),
        low_link: HashMap::new(),
        stack: Vec::new(),
        on_stack: HashSet::new(),
        components: RelayComponents::default(),
    };

    for api in apis {
        if !tarjan.index.contains_key(api) {
            tarjan.connect(api)?;
        }
    }

    Ok(tarjan.components)
}

// Workspace order, each api after the apis it relays to. An api of a cycle waits only for the apis
// outside its cycle, so every api is placed once and an api that relays into a cycle comes after
// the whole cycle.
fn relay_placement(
    apis: &[String],
    relays_to: &IndexMap<String, Vec<String>>,
    components: &RelayComponents,
) -> Result<Vec<String>, InternalError> {
    let mut placed: HashSet<&str> = HashSet::new();
    let mut order: Vec<String> = Vec::new();

    while order.len() < apis.len() {
        let next = apis.iter().find(|api| {
            !placed.contains(api.as_str()) && is_ready(api, relays_to, components, &placed)
        });
        let Some(next) = next else {
            return Err(InternalError::new(
                "relay order: no workspace api is ready to place",
            ));
        };

        placed.insert(next);
        order.push(next.clone());
    }

    Ok(order)
}

fn is_component_placed(api: &str, components: &RelayComponents, placed: &HashSet<&str>) -> bool {
    match components.members_of(api) {
        Some(members) => members
            .iter()
            .all(|member| placed.contains(member.as_str())),
        None => placed.contains(api),
    }
}

fn is_ready(
    api: &str,
    relays_to: &IndexMap<String, Vec<String>>,
    components: &RelayComponents,
    placed: &HashSet<&str>,
) -> bool {
    let own_component = components.members_of(api).unwrap_or_default();

    relays_to.get(api).into_iter().flatten().all(|target| {
        own_component.contains(target) || is_component_placed(target, components, placed)
    })
}

// One error per api of a cycle, at its first relay route into the cycle, with the other apis'
// routes related.
fn relay_cycle_diagnostics(
    members: &[String],
    routes_of: &IndexMap<String, Vec<WorkspaceRelayRoute>>,
) -> Result<Vec<(String, Vec<Diagnostic>)>, InternalError> {
    let names = members
        .iter()
        .map(|api| format!("'{api}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let route_into_cycle = |api: &str| -> Result<&WorkspaceRelayRoute, InternalError> {
        routes_of
            .get(api)
            .into_iter()
            .flatten()
            .find(|candidate| members.contains(&candidate.target))
            .ok_or_else(|| {
                InternalError::new(format!(
                    "relay order: api '{api}' has no relay into its cycle"
                ))
            })
    };
    let mut diagnostics = Vec::new();

    for api in members {
        let route = route_into_cycle(api)?;
        let mut related = Vec::new();

        for other in members.iter().filter(|other| *other != api) {
            let other_route = route_into_cycle(other)?;

            related.push(RelatedLocation {
                origin: DiagnosticOrigin {
                    api: Some(other.clone()),
                    ..other_route.origin.clone()
                },
                message: format!("api '{other}' relays to '{}' here", other_route.target),
            });
        }

        let diagnostic = Diagnostic {
            severity: Severity::Error,
            rule: RELAY_CYCLE_RULE_ID,
            message: format!(
                "Relay routes form a cycle between the apis {names}, so none of them can compile after the others."
            ),
            fix: format!(
                "Remove or retarget one relay route of the cycle, this one from '{api}' to '{}' or a related one.",
                route.target
            ),
            origin: route.origin.clone(),
            related,
        };

        diagnostics.push((api.clone(), vec![diagnostic]));
    }

    Ok(diagnostics)
}

/// The relay order of the workspace's apis, with the relay cycles it refuses.
///
/// # Errors
///
/// An [`InternalError`] when an api's relay route has no source location, or the order cannot
/// place an api.
pub(crate) fn workspace_relay_order(workspace: &RawWorkspace) -> Result<RelayOrder, InternalError> {
    let apis: Vec<String> = workspace.apis.iter().map(|api| api.name.clone()).collect();
    let workspace_apis: HashSet<&str> = apis.iter().map(String::as_str).collect();
    let mut routes_of: IndexMap<String, Vec<WorkspaceRelayRoute>> = IndexMap::new();
    let mut relays_to: IndexMap<String, Vec<String>> = IndexMap::new();

    for raw in &workspace.apis {
        let routes = workspace_relay_routes(raw, &workspace_apis)?;
        let targets: IndexSet<&String> = routes.iter().map(|route| &route.target).collect();

        relays_to.insert(raw.name.clone(), targets.into_iter().cloned().collect());
        routes_of.insert(raw.name.clone(), routes);
    }

    let components = relay_components(&apis, &relays_to)?;
    let mut diagnostics = Vec::new();

    for members in &components.members {
        let relays_to_itself = members.iter().any(|api| {
            relays_to
                .get(api)
                .is_some_and(|targets| targets.contains(api))
        });

        if members.len() > 1 || relays_to_itself {
            diagnostics.extend(relay_cycle_diagnostics(members, &routes_of)?);
        }
    }

    Ok(RelayOrder {
        order: relay_placement(&apis, &relays_to, &components)?,
        relays_to,
        diagnostics,
    })
}

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
