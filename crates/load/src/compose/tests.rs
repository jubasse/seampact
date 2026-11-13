use std::rc::Rc;

use seampact_diagnostics::{Diagnostic, diagnostic_location_key};
use seampact_ir::PackName;
use seampact_span::{FileId, TextSize};

use super::*;
use crate::source::ParsedFile;
use crate::{LOAD_MAX_TEXT, LOAD_MAX_WORK, ROOT_BOUNDARY};

const LONG_CHAIN: usize = 5_000;

fn pack(name: &str) -> FileLayer {
    FileLayer::Api(ApiLayer::Pack(PackName::new(name.to_owned())))
}

fn api() -> FileLayer {
    FileLayer::Api(ApiLayer::Api)
}

fn base() -> FileLayer {
    FileLayer::Api(ApiLayer::Base)
}

fn shared() -> FileLayer {
    FileLayer::Api(ApiLayer::Shared)
}

fn json(text: &str) -> JsonValue {
    let parsed: serde_json::Value = serde_json::from_str(text).expect("valid JSON");

    JsonValue::try_from(parsed).expect("a JSON value")
}

fn tree(text: &str) -> JsonObject {
    match json(text) {
        JsonValue::Object(object) => object,
        other => panic!("an object expected, got {other:?}"),
    }
}

/// A tree as `JSON.stringify` writes it, members in their own order.
fn written(object: &JsonObject) -> String {
    json_stringify(&JsonValue::Object(object.clone()))
}

/// The span of the first `needle` in `text`.
fn at(file: FileId, text: &str, needle: &str) -> Span {
    let start = text.find(needle).expect("the needle is in the text");
    let end = start + needle.len();

    Span::new(
        file,
        TextSize::from(u32::try_from(start).expect("a small text")),
        TextSize::from(u32::try_from(end).expect("a small text")),
    )
}

/// One load: the file table, the reporter and the budget every merge shares.
struct Load {
    files: SourceFiles,
    reporter: Reporter,
    budget: LoadBudget,
}

impl Load {
    fn new() -> Self {
        Self {
            files: SourceFiles::new(),
            reporter: Reporter::new(),
            budget: LoadBudget::new(),
        }
    }

    /// A layer build whose tree is `tree_json` and whose pointers are written where the needles
    /// of `text` are.
    fn layer(
        &mut self,
        layer: FileLayer,
        path: &str,
        text: &str,
        tree_json: &str,
        written_at: &[(&str, &str)],
    ) -> LayerBuild {
        let file = self.files.add(path, text).expect("the file is added");
        let mut locs = IndexMap::new();

        for (pointer, needle) in written_at {
            locs.insert((*pointer).to_owned(), at(file, text, needle));
        }

        LayerBuild {
            layer,
            parsed: Rc::new(ParsedFile {
                path: path.to_owned(),
                boundary: ROOT_BOUNDARY.to_owned(),
                file,
                root: None,
            }),
            tree: tree(tree_json),
            locs,
            uses: Vec::new(),
            refs: IndexMap::new(),
            pending_refs: Vec::new(),
            sources: IndexMap::new(),
        }
    }

    /// A layer that has no positions: only its file.
    fn bare_layer(&mut self, layer: FileLayer, path: &str, tree_json: &str) -> LayerBuild {
        self.layer(layer, path, "", tree_json, &[])
    }

    fn merge(&mut self, layers: &[LayerBuild]) -> Merged {
        merge_layers(layers, &mut self.reporter, &self.files, &mut self.budget)
            .expect("no internal error")
    }

    /// Leaves `left` units of work in the budget.
    fn spend_work(&mut self, left: u64) {
        let span = self.nowhere();

        assert!(
            self.budget
                .charge(
                    LOAD_MAX_WORK - left,
                    || span,
                    &mut self.reporter,
                    &self.files
                )
                .expect("no internal error")
        );
    }

    /// Leaves `left` characters of text in the budget.
    fn spend_text(&mut self, left: u64) {
        let span = self.nowhere();

        assert!(
            self.budget
                .charge_text(
                    LOAD_MAX_TEXT - left,
                    || span,
                    &mut self.reporter,
                    &self.files
                )
                .expect("no internal error")
        );
    }

    fn nowhere(&mut self) -> Span {
        let file = self.files.add("spent.yaml", "").expect("a file");

        Span::new(file, TextSize::from(0), TextSize::from(0))
    }

    fn rules(&self) -> Vec<String> {
        self.reporter
            .diagnostics()
            .iter()
            .map(|diagnostic| {
                diagnostic
                    .rule
                    .as_str()
                    .trim_start_matches("seampact/load/")
                    .to_owned()
            })
            .collect()
    }

    /// `file:line:column` of an origin.
    fn place(&self, origin: &seampact_diagnostics::DiagnosticOrigin) -> String {
        let span = self
            .reporter
            .locations()
            .get(&diagnostic_location_key(origin))
            .expect("a located diagnostic");
        let location = self.files.location(*span).expect("inside its file");

        format!("{}:{}:{}", location.file, location.line, location.column)
    }

    fn only_diagnostic(&self) -> &Diagnostic {
        let [diagnostic] = self.reporter.diagnostics() else {
            panic!("one diagnostic expected, got {}", self.reporter.len());
        };

        diagnostic
    }
}

fn layer_of(origin: Option<&Origin>) -> String {
    origin
        .map(|origin| origin.layer.to_string())
        .expect("an origin")
}

#[test]
fn a_name_declared_by_two_layers_is_reported_at_the_second_and_names_the_first() {
    let mut load = Load::new();
    let base_layer = load.layer(
        base(),
        "base.yaml",
        "errors:\n  api.forbidden: { status: 403 }\n",
        r#"{"errors":{"api.forbidden":{"status":403}}}"#,
        &[("/errors/api.forbidden", "api.forbidden")],
    );
    let api_layer = load.layer(
        api(),
        "api.yaml",
        "api: { name: tasks }\nextends: ./base.yaml\nerrors:\n  api.forbidden: { status: 401 }\n",
        r#"{"errors":{"api.forbidden":{"status":401}},"extends":"./base.yaml"}"#,
        &[("/errors/api.forbidden", "api.forbidden")],
    );
    let merged = load.merge(&[base_layer, api_layer]);
    let diagnostic = load.only_diagnostic();

    assert_eq!(diagnostic.rule.as_str(), "seampact/load/declaration-twice");
    assert_eq!(
        diagnostic.message,
        "'api.forbidden' (errors) is declared by both 'base' (base.yaml) and 'api' (api.yaml), and a declaration is never overridden, even when the two are identical"
    );
    assert_eq!(diagnostic.fix, "remove the copy");
    assert_eq!(load.place(&diagnostic.origin), "api.yaml:4:3");

    let [related] = diagnostic.related.as_slice() else {
        panic!("one related position expected");
    };

    assert_eq!(related.message, "first declared here");
    assert_eq!(load.place(&related.origin), "base.yaml:2:3");

    // The first declaration stays, and keeps its origin.
    assert_eq!(
        written(&merged.merged),
        r#"{"errors":{"api.forbidden":{"status":403}}}"#
    );
    assert_eq!(
        layer_of(merged.leaf_origins.get("/errors/api.forbidden/status")),
        "base"
    );
}

#[test]
fn two_identical_declarations_are_still_a_conflict() {
    let mut load = Load::new();
    let base_layer = load.bare_layer(base(), "base.yaml", r#"{"errors":{"e":{"status":403}}}"#);
    let api_layer = load.bare_layer(api(), "api.yaml", r#"{"errors":{"e":{"status":403}}}"#);

    load.merge(&[base_layer, api_layer]);

    assert_eq!(load.rules(), ["declaration-twice"]);
}

#[test]
fn one_file_element_reached_by_two_layers_is_one_declaration() {
    let mut load = Load::new();
    let mut shared_layer = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );
    let mut api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );

    shared_layer
        .sources
        .insert("/schemas/Item".to_owned(), "types.yaml#/Item".to_owned());
    api_layer
        .sources
        .insert("/schemas/Item".to_owned(), "types.yaml#/Item".to_owned());

    let merged = load.merge(&[shared_layer, api_layer]);

    assert!(load.reporter.is_empty());
    assert_eq!(
        layer_of(merged.leaf_origins.get("/schemas/Item/type")),
        "shared"
    );
}

#[test]
fn different_file_elements_of_one_name_are_two_declarations() {
    let mut load = Load::new();
    let mut shared_layer = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );
    let mut api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );

    shared_layer
        .sources
        .insert("/schemas/Item".to_owned(), "a.yaml#/Item".to_owned());
    api_layer
        .sources
        .insert("/schemas/Item".to_owned(), "b.yaml#/Item".to_owned());

    load.merge(&[shared_layer, api_layer]);

    assert_eq!(load.rules(), ["declaration-twice"]);
}

#[test]
fn an_element_with_a_file_source_and_one_without_are_two_declarations() {
    let mut load = Load::new();
    let mut shared_layer = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );
    let api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"schemas":{"Item":{"type":"string"}}}"#,
    );

    shared_layer
        .sources
        .insert("/schemas/Item".to_owned(), "a.yaml#/Item".to_owned());

    load.merge(&[shared_layer, api_layer]);

    assert_eq!(load.rules(), ["declaration-twice"]);
}

#[test]
fn a_declaration_without_its_own_position_is_reported_at_its_files_entry_or_top() {
    let mut load = Load::new();
    let tree_json = r#"{"schemas":{"A":{}}}"#;
    let first = load.bare_layer(shared(), "shared.yaml", tree_json);
    let second = load.layer(
        api(),
        "api.yaml",
        "# c\nschemas:\n  A: {}\n",
        tree_json,
        &[("", "schemas")],
    );
    let third = load.layer(base(), "base.yaml", "\n\nx", tree_json, &[]);

    load.merge(&[first, second, third]);

    let places: Vec<String> = load
        .reporter
        .diagnostics()
        .iter()
        .map(|diagnostic| load.place(&diagnostic.origin))
        .collect();

    // The layer's own entry for the whole file, else the start of the file.
    assert_eq!(places, ["api.yaml:2:1", "base.yaml:1:1"]);
}

#[test]
fn settings_override_by_leaf() {
    let mut load = Load::new();
    let pack_layer = load.bare_layer(
        pack("p"),
        "pack.yaml",
        r#"{"pack":{"name":"p"},"conventions":{"paging":{"default":"offset","maxLimit":20},"errors":{"every":["a"],"derived":{"forbidden":"api.forbidden","missing":"api.missing"}},"cache":{"families":{"minute":"60s","hour":"1h"}}}}"#,
    );
    let base_layer = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"paging":{"default":"cursor"},"header":{"name":"X"}}}"#,
    );
    let api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"api":{"name":"tasks"},"extends":"./base.yaml","packs":["./pack.yaml"],"conventions":{"paging":{"maxLimit":50},"errors":{"every":["b","a"],"derived":{"forbidden":"api.denied"}},"cache":{"families":{"minute":"120s"}}}}"#,
    );
    let merged = load.merge(&[pack_layer, base_layer, api_layer]);

    assert!(load.reporter.is_empty());
    assert_eq!(
        written(&merged.merged),
        concat!(
            r#"{"conventions":{"paging":{"default":"cursor","maxLimit":50},"#,
            r#""errors":{"every":["a","b"],"derived":{"forbidden":"api.denied","missing":"api.missing"}},"#,
            r#""cache":{"families":{"minute":"120s","hour":"1h"}},"header":{"name":"X"}},"#,
            r#""api":{"name":"tasks"}}"#
        )
    );

    let origins = &merged.leaf_origins;

    assert_eq!(
        origins.get("/conventions/paging/default"),
        Some(&Origin {
            api: None,
            layer: Layer::Base,
            pointer: "/conventions/paging/default".to_owned(),
        })
    );
    assert_eq!(layer_of(origins.get("/conventions/paging/maxLimit")), "api");
    assert_eq!(
        layer_of(origins.get("/conventions/errors/derived/missing")),
        "pack:p"
    );
    assert_eq!(
        layer_of(origins.get("/conventions/errors/derived/forbidden")),
        "api"
    );
    assert_eq!(
        layer_of(origins.get("/conventions/cache/families/hour")),
        "pack:p"
    );
    assert_eq!(
        layer_of(origins.get("/conventions/cache/families/minute")),
        "api"
    );
    assert_eq!(layer_of(origins.get("/conventions/header/name")), "base");
    // A list is one leaf, owned by the last layer that extended it.
    assert_eq!(layer_of(origins.get("/conventions/errors/every")), "api");
}

#[test]
fn directive_keys_are_not_merged() {
    let mut load = Load::new();
    let api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"api":{"name":"t"},"extends":"./b.yaml","packs":[],"pack":{"name":"p"},"workspace":{"apis":{}},"surfaces":{}}"#,
    );
    let merged = load.merge(&[api_layer]);

    assert_eq!(
        written(&merged.merged),
        r#"{"api":{"name":"t"},"surfaces":{}}"#
    );
}

#[test]
fn a_later_scalar_replaces_a_mapping_and_its_origins() {
    let mut load = Load::new();
    let first = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"header":{"name":"X"}}}"#,
    );
    let second = load.bare_layer(api(), "api.yaml", r#"{"conventions":{"header":"none"}}"#);
    let merged = load.merge(&[first, second]);

    assert_eq!(
        written(&merged.merged),
        r#"{"conventions":{"header":"none"}}"#
    );
    assert!(!merged.leaf_origins.contains_key("/conventions/header/name"));
    assert_eq!(
        layer_of(merged.leaf_origins.get("/conventions/header")),
        "api"
    );
}

#[test]
fn a_later_layer_filling_an_empty_mapping_leaves_no_stale_origin_on_the_mapping() {
    let mut load = Load::new();
    let pack_layer = load.bare_layer(
        pack("p"),
        "p.yaml",
        r#"{"conventions":{"header":{},"empty":{}}}"#,
    );
    let api_layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"conventions":{"header":{"name":"X"},"empty":{}}}"#,
    );
    let merged = load.merge(&[pack_layer, api_layer]);

    assert!(!merged.leaf_origins.contains_key("/conventions/header"));
    assert_eq!(
        layer_of(merged.leaf_origins.get("/conventions/header/name")),
        "api"
    );
    assert_eq!(
        layer_of(merged.leaf_origins.get("/conventions/empty")),
        "api"
    );
}

#[test]
fn an_empty_mapping_over_a_filled_one_changes_nothing() {
    let mut load = Load::new();
    let first = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"header":{"name":"X"}}}"#,
    );
    let second = load.bare_layer(api(), "api.yaml", r#"{"conventions":{"header":{}}}"#);
    let merged = load.merge(&[first, second]);

    assert_eq!(
        written(&merged.merged),
        r#"{"conventions":{"header":{"name":"X"}}}"#
    );
    assert_eq!(
        layer_of(merged.leaf_origins.get("/conventions/header/name")),
        "base"
    );
}

#[test]
fn a_replaced_entry_of_a_leaf_map_loses_the_origins_under_it() {
    let mut load = Load::new();
    let first = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"cache":{"families":{"minute":{"ttl":"60s"}}}}}"#,
    );
    let second = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"conventions":{"cache":{"families":{"minute":"120s"}}}}"#,
    );
    let merged = load.merge(&[first, second]);

    assert_eq!(
        written(&merged.merged),
        r#"{"conventions":{"cache":{"families":{"minute":"120s"}}}}"#
    );
    assert!(
        !merged
            .leaf_origins
            .contains_key("/conventions/cache/families/minute/ttl")
    );
    assert_eq!(
        layer_of(
            merged
                .leaf_origins
                .get("/conventions/cache/families/minute")
        ),
        "api"
    );
}

#[test]
fn the_union_list_keeps_first_seen_members_by_their_json_text() {
    let mut load = Load::new();
    let first = load.bare_layer(
        pack("p"),
        "p.yaml",
        r#"{"conventions":{"errors":{"every":["a",1,9007199254740992]}}}"#,
    );
    let second = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"conventions":{"errors":{"every":["a",1.0,9007199254740993,{"k":1,"j":2},{"j":2,"k":1},{"k":1,"j":2}]}}}"#,
    );
    let third = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"errors":{"every":[1e21,"b",{"j":2,"k":1}]}}}"#,
    );
    let merged = load.merge(&[first, second, third]);

    // `1.0` is `1`, and an integer past 2^53 is the double JavaScript holds; two objects whose
    // members come in another order are two members.
    assert_eq!(
        written(&merged.merged),
        r#"{"conventions":{"errors":{"every":["a",1,9007199254740992,{"k":1,"j":2},{"j":2,"k":1},1e+21,"b"]}}}"#
    );
    assert_eq!(
        layer_of(merged.leaf_origins.get("/conventions/errors/every")),
        "base"
    );
}

#[test]
fn a_union_list_over_a_value_that_is_not_a_list_replaces_it() {
    let mut load = Load::new();
    let first = load.bare_layer(
        base(),
        "base.yaml",
        r#"{"conventions":{"errors":{"every":"all"}}}"#,
    );
    let second = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"conventions":{"errors":{"every":["a"]}}}"#,
    );
    let merged = load.merge(&[first, second]);

    assert_eq!(
        written(&merged.merged),
        r#"{"conventions":{"errors":{"every":["a"]}}}"#
    );
}

#[test]
fn derive_entries_are_declarations_and_merge_in_layer_order() {
    let mut load = Load::new();
    let first = load.layer(
        pack("a"),
        "a.yaml",
        "pack: { name: a, version: 1.0.0 }\nderive:\n  - { entry: crud, select: {} }\n  - { entry: other }\n",
        r#"{"pack":{"name":"a"},"derive":[{"entry":"crud","select":{}},{"entry":"other"}]}"#,
        &[("/derive/0", "{ entry: crud"), ("/derive/1", "{ entry: other")],
    );
    let second = load.layer(
        pack("b"),
        "b.yaml",
        "pack: { name: b, version: 1.0.0 }\nderive:\n  - { entry: crud }\n  - { entry: more }\n",
        r#"{"pack":{"name":"b"},"derive":[{"entry":"crud"},{"entry":"more"}]}"#,
        &[
            ("/derive/0", "{ entry: crud"),
            ("/derive/1", "{ entry: more"),
        ],
    );
    let merged = load.merge(&[first, second]);
    let diagnostic = load.only_diagnostic();

    assert_eq!(
        diagnostic.message,
        "derive entry 'crud' is declared by both 'pack:a' (a.yaml) and 'pack:b' (b.yaml), and an entry name is unique across every layer"
    );
    assert_eq!(diagnostic.fix, "remove the copy, or rename one entry");
    assert_eq!(load.place(&diagnostic.origin), "b.yaml:3:5");
    assert_eq!(load.place(&diagnostic.related[0].origin), "a.yaml:3:5");
    assert_eq!(
        written(&merged.merged),
        r#"{"derive":[{"entry":"crud","select":{}},{"entry":"other"},{"entry":"more"}]}"#
    );
    assert_eq!(
        merged.leaf_origins.get("/derive/2/entry"),
        Some(&Origin {
            api: None,
            layer: Layer::Pack(PackName::new("b".to_owned())),
            pointer: "/derive/1/entry".to_owned(),
        })
    );
}

#[test]
fn derive_entries_named_alike_in_one_pack_say_so() {
    let mut load = Load::new();
    let layer = load.layer(
        pack("a"),
        "a.yaml",
        "pack: { name: a, version: 1.0.0 }\nderive:\n  - { entry: crud }\n  - { entry: crud, x: 1 }\n",
        r#"{"derive":[{"entry":"crud"},{"entry":"crud","x":1}]}"#,
        &[("/derive/0", "{ entry: crud }"), ("/derive/1", "{ entry: crud, x: 1 }")],
    );

    load.merge(&[layer]);

    let diagnostic = load.only_diagnostic();

    assert!(
        diagnostic
            .message
            .contains("declared twice in the pack 'a'")
    );
    assert_eq!(diagnostic.fix, "rename one of the two entries");
    assert_eq!(load.place(&diagnostic.related[0].origin), "a.yaml:3:5");
}

#[test]
fn derive_entries_named_alike_in_one_api_file_name_the_file_not_a_pack() {
    let mut load = Load::new();
    let layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"derive":[{"entry":"crud"},{"entry":"crud"}]}"#,
    );

    load.merge(&[layer]);

    let message = &load.only_diagnostic().message;

    assert!(message.contains("is declared twice in 'api.yaml'"));
    assert!(!message.contains("pack"));
}

#[test]
fn derive_entries_without_a_string_name_are_never_declarations() {
    let mut load = Load::new();
    let layer = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"derive":[{"entry":1},{"entry":1},{}]}"#,
    );
    let merged = load.merge(&[layer]);

    assert!(load.reporter.is_empty());
    assert_eq!(
        written(&merged.merged),
        r#"{"derive":[{"entry":1},{"entry":1},{}]}"#
    );
}

#[test]
fn extension_prefixes_merge_per_key_and_a_key_declared_twice_is_reported() {
    let mut load = Load::new();
    let first = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"extensions":{"x-a":{"one":1},"x-flag":true}}"#,
    );
    let second = load.bare_layer(
        api(),
        "api.yaml",
        r#"{"extensions":{"x-a":{"one":2,"two":2},"x-flag":false,"x-b":{"three":3}}}"#,
    );
    let merged = load.merge(&[first, second]);

    assert_eq!(
        written(&merged.merged),
        r#"{"extensions":{"x-a":{"one":1,"two":2},"x-flag":true,"x-b":{"three":3}}}"#
    );

    let messages: Vec<&str> = load
        .reporter
        .diagnostics()
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();

    assert_eq!(messages.len(), 2);
    assert!(messages[0].starts_with("'one' (extension 'x-a') is declared by both"));
    assert!(messages[1].starts_with("'x-flag' (extension prefix) is declared by both"));
    assert_eq!(
        layer_of(merged.leaf_origins.get("/extensions/x-a/two")),
        "api"
    );
}

#[test]
fn a_format_is_named_a_format_in_the_conflict() {
    let mut load = Load::new();
    let first = load.bare_layer(shared(), "shared.yaml", r#"{"formats":{"f":{}}}"#);
    let second = load.bare_layer(api(), "api.yaml", r#"{"formats":{"f":{}}}"#);

    load.merge(&[first, second]);

    assert!(
        load.only_diagnostic()
            .message
            .starts_with("'f' (format) is declared by both")
    );
}

#[test]
fn a_declaration_section_that_is_not_a_mapping_is_a_setting() {
    let mut load = Load::new();
    let first = load.bare_layer(base(), "base.yaml", r#"{"schemas":{"A":{}}}"#);
    let second = load.bare_layer(api(), "api.yaml", r#"{"schemas":["x"]}"#);
    let merged = load.merge(&[first, second]);

    assert!(load.reporter.is_empty());
    assert_eq!(written(&merged.merged), r#"{"schemas":["x"]}"#);
    assert!(!merged.leaf_origins.contains_key("/schemas/A"));
}

#[test]
fn a_setting_written_where_a_later_layer_declares_is_replaced_by_the_declarations() {
    let mut load = Load::new();
    let first = load.bare_layer(base(), "base.yaml", r#"{"schemas":"none"}"#);
    let second = load.bare_layer(api(), "api.yaml", r#"{"schemas":{"A":{"type":"string"}}}"#);
    let merged = load.merge(&[first, second]);

    assert!(load.reporter.is_empty());
    assert_eq!(
        written(&merged.merged),
        r#"{"schemas":{"A":{"type":"string"}}}"#
    );
    assert!(!merged.leaf_origins.contains_key("/schemas"));
}

#[test]
fn keys_that_need_escaping_make_escaped_pointers() {
    let mut load = Load::new();
    let first = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"schemas":{"a/b~c":{"type":"string"}}}"#,
    );
    let second = load.bare_layer(api(), "api.yaml", r#"{"schemas":{"a/b~c":{}}}"#);
    let merged = load.merge(&[first, second]);

    assert_eq!(load.rules(), ["declaration-twice"]);
    assert_eq!(
        merged.leaf_origins.get("/schemas/a~1b~0c/type"),
        Some(&Origin {
            api: None,
            layer: Layer::Shared,
            pointer: "/schemas/a~1b~0c/type".to_owned(),
        })
    );
}

#[test]
fn members_and_origins_come_in_javascript_key_order() {
    let mut load = Load::new();
    let first = load.bare_layer(
        shared(),
        "shared.yaml",
        r#"{"schemas":{"b":{"x":1},"10":{"x":1},"9":{"x":1}}}"#,
    );
    let second = load.bare_layer(api(), "api.yaml", r#"{"schemas":{"0":{"x":1}}}"#);
    let merged = load.merge(&[first, second]);
    let pointers: Vec<&str> = merged.leaf_origins.keys().map(String::as_str).collect();

    assert_eq!(
        written(&merged.merged),
        r#"{"schemas":{"0":{"x":1},"9":{"x":1},"10":{"x":1},"b":{"x":1}}}"#
    );
    // A declaration's own pointer is an origin too, before the leaves under it.
    assert_eq!(
        pointers,
        [
            "/schemas/0",
            "/schemas/0/x",
            "/schemas/9",
            "/schemas/9/x",
            "/schemas/10",
            "/schemas/10/x",
            "/schemas/b",
            "/schemas/b/x"
        ]
    );
}

#[test]
fn a_merge_never_writes_into_a_layer_the_next_api_shares() {
    let shared_json = r#"{"conventions":{"paging":{"default":"offset","maxLimit":20},"errors":{"every":["a"]}},"schemas":{"S":{"type":"string"}}}"#;
    let mut load = Load::new();
    let shared_layer = load.bare_layer(shared(), "shared.yaml", shared_json);
    let first_api = load.bare_layer(
        api(),
        "one.yaml",
        r#"{"conventions":{"paging":{"maxLimit":50},"errors":{"every":["b"]}}}"#,
    );
    let second_api = load.bare_layer(api(), "two.yaml", r#"{"api":{"name":"two"}}"#);
    let before = written(&shared_layer.tree);
    let one = load.merge(&[shared_layer.clone(), first_api]);
    let two = load.merge(&[shared_layer.clone(), second_api]);

    assert_eq!(written(&shared_layer.tree), before);
    assert_eq!(
        written(&one.merged),
        r#"{"conventions":{"paging":{"default":"offset","maxLimit":50},"errors":{"every":["a","b"]}},"schemas":{"S":{"type":"string"}}}"#
    );
    assert_eq!(
        written(&two.merged),
        r#"{"conventions":{"paging":{"default":"offset","maxLimit":20},"errors":{"every":["a"]}},"schemas":{"S":{"type":"string"}},"api":{"name":"two"}}"#
    );
    assert_eq!(
        layer_of(two.leaf_origins.get("/conventions/paging/maxLimit")),
        "shared"
    );
    assert_eq!(
        layer_of(one.leaf_origins.get("/conventions/paging/maxLimit")),
        "api"
    );
    assert!(load.reporter.is_empty());
}

#[test]
fn no_layer_is_an_empty_tree() {
    let mut load = Load::new();
    let merged = load.merge(&[]);

    assert!(merged.merged.is_empty());
    assert!(merged.leaf_origins.is_empty());
}

#[test]
fn spending_the_work_budget_reports_once_at_the_key_being_merged_and_stops() {
    let mut load = Load::new();
    let layer = load.layer(
        api(),
        "api.yaml",
        "# c\nschemas:\n  A: {}\n  B: {}\nconventions:\n  paging: {}\n",
        r#"{"schemas":{"A":{"x":1},"B":{"x":1}},"conventions":{"paging":{"x":1}}}"#,
        &[("/schemas", "schemas"), ("/conventions", "conventions")],
    );

    load.spend_work(3);

    let merged = load.merge(&[layer]);
    let diagnostic = load.only_diagnostic();

    assert_eq!(diagnostic.rule.as_str(), "seampact/load/expansion-limit");
    assert_eq!(load.place(&diagnostic.origin), "api.yaml:2:1");
    assert!(load.budget.exhausted());
    assert!(!merged.merged.contains_key("conventions"));
}

#[test]
fn the_text_budget_counts_the_keys_in_utf16_units() {
    // The key is one character and two UTF-16 units: two units left admit it, one does not.
    let tree_json = r#"{"conventions":{"\ud83d\ude00":1}}"#;
    let mut admitted = Load::new();
    let layer = admitted.bare_layer(api(), "api.yaml", tree_json);

    admitted.spend_text(2);

    let merged = admitted.merge(&[layer]);

    assert!(admitted.reporter.is_empty());
    assert_eq!(
        written(&merged.merged),
        "{\"conventions\":{\"\u{1F600}\":1}}"
    );

    let mut refused = Load::new();
    let layer = refused.bare_layer(api(), "api.yaml", tree_json);

    refused.spend_text(1);
    refused.merge(&[layer]);

    assert_eq!(refused.rules(), ["expansion-limit"]);
}

/// The units of work merging one layer with `tree_json` costs: the least a budget must have left.
fn work_of_merging(tree_json: &str) -> u64 {
    (0..100)
        .find(|spare| {
            let mut load = Load::new();
            let layer = load.bare_layer(api(), "api.yaml", tree_json);

            load.spend_work(*spare);
            load.merge(&[layer]);

            load.reporter.is_empty()
        })
        .expect("a merge costs under 100 units")
}

#[test]
fn a_pointer_over_256_utf16_units_costs_one_more_unit_each_time_it_is_written() {
    let short = work_of_merging(r#"{"conventions":{"k":1}}"#);
    let long_key = "k".repeat(300);
    let long = work_of_merging(&format!(r#"{{"conventions":{{"{long_key}":1}}}}"#));
    // The same key in two-unit characters is over 256 units from 129 characters on.
    let astral_key = "\u{1F600}".repeat(129);
    let astral = work_of_merging(&format!(r#"{{"conventions":{{"{astral_key}":1}}}}"#));

    // The pointer of the leaf is written by the record and by the walk of the origins.
    assert_eq!(long - short, 2);
    assert_eq!(astral - short, 2);
}

fn nested_objects(depth: usize, leaf: JsonValue) -> JsonValue {
    (0..depth).fold(leaf, |inner, _| {
        let mut object = JsonObject::new();

        object.insert("a".to_owned(), inner);

        JsonValue::Object(object)
    })
}

fn nested_arrays(depth: usize, leaf: JsonValue) -> JsonValue {
    (0..depth).fold(leaf, |inner, _| JsonValue::Array(vec![inner]))
}

fn number(value: f64) -> JsonValue {
    JsonValue::Number(seampact_json::JsonNumber::from_f64(value).expect("a finite number"))
}

#[test]
fn a_chain_far_deeper_than_the_call_stack_is_merged_without_recursion() {
    let mut load = Load::new();
    let mut shared_layer = load.bare_layer(shared(), "shared.yaml", "{}");
    let mut base_layer = load.bare_layer(base(), "base.yaml", "{}");
    let api_layer = load.bare_layer(api(), "api.yaml", r#"{"lists":1}"#);

    for (layer, leaf) in [(&mut shared_layer, 1.0), (&mut base_layer, 2.0)] {
        layer.tree.insert(
            "conventions".to_owned(),
            nested_objects(LONG_CHAIN, number(leaf)),
        );
        layer
            .tree
            .insert("lists".to_owned(), nested_arrays(LONG_CHAIN, number(leaf)));
    }

    let layers = [shared_layer, base_layer, api_layer];
    let merged = load.merge(&layers);

    assert!(load.reporter.is_empty(), "{:?}", load.rules());

    let mut depth = 0;
    let mut cursor = merged.merged.get("conventions");

    while let Some(JsonValue::Object(object)) = cursor {
        depth += 1;
        cursor = object.get("a");
    }

    assert_eq!(depth, LONG_CHAIN);
    assert_eq!(cursor, Some(&number(2.0)));

    let deepest = format!("/conventions{}", "/a".repeat(LONG_CHAIN));

    assert_eq!(layer_of(merged.leaf_origins.get(&deepest)), "base");
    assert_eq!(layer_of(merged.leaf_origins.get("/lists")), "api");

    // Dropping a tree this deep recurses in `Drop`: the process ends instead.
    std::mem::forget(layers);
    std::mem::forget(merged);
}
