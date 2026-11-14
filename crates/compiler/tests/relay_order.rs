//! The relay order of a workspace: order, relays and the refused cycles, over in-memory workspaces.

use std::error::Error;
use std::fmt::Write;

use indexmap::IndexMap;
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_compiler::{RelayOrder, StageAnswer, workspace_relay_order};
use seampact_diagnostics::{DiagnosticLayer, Severity};
use seampact_load::{LoadOptions, MemoryReader, load_workspace};

const CYCLE_RULE: &str = "seampact/workspace/relay-cycle";

fn api_file(name: &str, relays: &[&str]) -> String {
    let mut routes = String::new();

    for (position, target) in relays.iter().enumerate() {
        writeln!(routes, "      relay{position}: {{ relays: {target} }}").ok();
    }

    format!(
        "api: {{ name: {name}, version: 1 }}\nsurfaces:\n  svc:\n    routes:\n      ping: {{ method: get }}\n{routes}"
    )
}

fn workspace_of(apis: &[(&str, &[&str])]) -> Result<RawWorkspace, Box<dyn Error>> {
    let mut entries = String::new();

    for (name, _) in apis {
        writeln!(entries, "    {name}: ./{name}.yaml").ok();
    }

    let mut files = vec![(
        "workspace.yaml".to_owned(),
        format!(
            "workspace:\n  apis:\n{entries}  imports:\n    billing: {{ package: \"@acme/billing\", version: 1.0.0, api: billing, integrity: sha256-x }}\n"
        ),
    )];

    for (name, relays) in apis {
        files.push((format!("{name}.yaml"), api_file(name, relays)));
    }

    let reader = MemoryReader::new(files);
    let loaded = load_workspace(&LoadOptions {
        reader: &reader,
        entry: "workspace.yaml",
    })?;

    assert_eq!(loaded.diagnostics, Vec::new());

    Ok(loaded.workspace)
}

fn relay_of(workspace: &RawWorkspace) -> Result<RelayOrder, Box<dyn Error>> {
    match workspace_relay_order(workspace)? {
        StageAnswer::Ported(relay) => Ok(relay),
        StageAnswer::NotPorted => Err("the relay order is not ported".into()),
    }
}

fn relays_to_of(pairs: &[(&str, &[&str])]) -> IndexMap<String, Vec<String>> {
    pairs
        .iter()
        .map(|(api, targets)| {
            (
                (*api).to_owned(),
                targets.iter().map(|target| (*target).to_owned()).collect(),
            )
        })
        .collect()
}

fn strings(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn no_relay_keeps_workspace_order() -> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(&[("c", &[]), ("a", &[]), ("b", &[])])?)?;

    assert_eq!(relay.order, strings(&["c", "a", "b"]));
    assert_eq!(
        relay.relays_to,
        relays_to_of(&[("c", &[]), ("a", &[]), ("b", &[])])
    );
    assert_eq!(relay.diagnostics, Vec::new());

    Ok(())
}

#[test]
fn a_chain_orders_the_relayed_api_first() -> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(&[
        ("a", &["b.get"]),
        ("b", &["c.get"]),
        ("c", &[]),
    ])?)?;

    assert_eq!(relay.order, strings(&["c", "b", "a"]));
    assert_eq!(
        relay.relays_to,
        relays_to_of(&[("a", &["b"]), ("b", &["c"]), ("c", &[])])
    );

    Ok(())
}

#[test]
fn a_diamond_keeps_workspace_order_where_no_relay_decides() -> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(&[
        ("top", &["left.get", "right.get"]),
        ("left", &["base.get"]),
        ("right", &["base.get"]),
        ("base", &[]),
    ])?)?;

    assert_eq!(relay.order, strings(&["base", "left", "right", "top"]));
    assert_eq!(
        relay.relays_to,
        relays_to_of(&[
            ("top", &["left", "right"]),
            ("left", &["base"]),
            ("right", &["base"]),
            ("base", &[]),
        ])
    );

    Ok(())
}

#[test]
fn a_relay_to_an_import_to_no_api_or_with_no_api_name_is_not_ordered() -> Result<(), Box<dyn Error>>
{
    let relay = relay_of(&workspace_of(&[
        (
            "a",
            &[
                "billing.getInvoice",
                "nowhere.get",
                "b.get",
                "b.list",
                "b",
                ".get",
            ],
        ),
        ("b", &[]),
    ])?)?;

    assert_eq!(relay.order, strings(&["b", "a"]));
    assert_eq!(relay.relays_to, relays_to_of(&[("a", &["b"]), ("b", &[])]));
    assert_eq!(relay.diagnostics, Vec::new());

    Ok(())
}

fn assert_cycle_refused(apis: &[(&str, &[&str])], cycle: &[&str]) -> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(apis)?)?;
    let names = cycle
        .iter()
        .map(|api| format!("'{api}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let reported: Vec<&str> = relay
        .diagnostics
        .iter()
        .map(|(api, _)| api.as_str())
        .collect();

    assert_eq!(reported, cycle);

    let mut ordered = relay.order.clone();

    ordered.sort();

    let mut expected: Vec<String> = apis.iter().map(|(name, _)| (*name).to_owned()).collect();

    expected.sort();

    assert_eq!(ordered, expected);

    for (_, diagnostics) in &relay.diagnostics {
        let [diagnostic] = diagnostics.as_slice() else {
            return Err("one diagnostic per api of the cycle".into());
        };

        assert_eq!(diagnostic.rule.as_str(), CYCLE_RULE);
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(
            diagnostic
                .message
                .contains(&format!("between the apis {names},")),
            "{}",
            diagnostic.message
        );
    }

    Ok(())
}

#[test]
fn a_cycle_of_two_apis_is_refused() -> Result<(), Box<dyn Error>> {
    assert_cycle_refused(
        &[("a", &["b.get"]), ("b", &["a.get"]), ("c", &[])],
        &["a", "b"],
    )
}

#[test]
fn a_cycle_of_three_apis_is_refused() -> Result<(), Box<dyn Error>> {
    assert_cycle_refused(
        &[("a", &["b.get"]), ("b", &["c.get"]), ("c", &["a.get"])],
        &["a", "b", "c"],
    )
}

#[test]
fn an_api_relaying_to_itself_is_a_cycle() -> Result<(), Box<dyn Error>> {
    assert_cycle_refused(&[("a", &["a.get"]), ("b", &[])], &["a"])
}

#[test]
fn an_api_that_relays_into_a_cycle_comes_after_it_and_is_not_part_of_it()
-> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(&[
        ("d", &["a.get"]),
        ("a", &["b.get"]),
        ("b", &["a.get"]),
    ])?)?;

    assert_eq!(relay.order, strings(&["a", "b", "d"]));

    let reported: Vec<&str> = relay
        .diagnostics
        .iter()
        .map(|(api, _)| api.as_str())
        .collect();

    assert_eq!(reported, ["a", "b"]);

    Ok(())
}

#[test]
fn a_relay_route_with_no_source_location_is_an_internal_error_naming_it()
-> Result<(), Box<dyn Error>> {
    let mut workspace = workspace_of(&[("a", &["b.get"]), ("b", &[])])?;
    let unlocated: &mut RawApi = workspace.apis.first_mut().ok_or("no first api")?;

    unlocated.leaf_origins.clear();
    unlocated.layers.clear();

    let Err(internal) = workspace_relay_order(&workspace) else {
        return Err("an unlocated relay route must be refused".into());
    };

    assert!(
        internal
            .to_string()
            .contains("api 'a' has no source location for /surfaces/svc/routes/relay0/relays"),
        "{internal}"
    );

    Ok(())
}

#[test]
fn a_relay_cycle_is_located_at_each_apis_route_with_the_others_related()
-> Result<(), Box<dyn Error>> {
    let relay = relay_of(&workspace_of(&[
        ("a", &["b.get"]),
        ("b", &["c.get"]),
        ("c", &["a.get"]),
    ])?)?;

    for (api, diagnostics) in &relay.diagnostics {
        let [diagnostic] = diagnostics.as_slice() else {
            return Err("one diagnostic per api".into());
        };

        assert_eq!(diagnostic.origin.layer, DiagnosticLayer::Api);
        assert_eq!(
            diagnostic.origin.pointer,
            "/surfaces/svc/routes/relay0/relays"
        );
        assert_eq!(diagnostic.origin.api, None);
        assert_ne!(diagnostic.fix, "");

        let related_apis: Vec<Option<&str>> = diagnostic
            .related
            .iter()
            .map(|related| related.origin.api.as_deref())
            .collect();
        let expected: Vec<Option<&str>> = ["a", "b", "c"]
            .into_iter()
            .filter(|other| other != api)
            .map(Some)
            .collect();

        assert_eq!(related_apis, expected, "api {api}");
    }

    Ok(())
}
