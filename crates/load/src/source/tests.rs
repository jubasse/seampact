use std::cell::RefCell;
use std::fs;

use seampact_authoring::{ApiLayer, FileLayer};
use seampact_diagnostics::diagnostic_location_key;
use seampact_ir::PackName;

use super::*;
use crate::MemoryReader;

const PITFALL_FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/loader/pitfalls"
);

fn memory(files: &[(&str, &str)]) -> MemoryReader {
    MemoryReader::new(
        files
            .iter()
            .map(|(path, text)| ((*path).to_owned(), (*text).to_owned())),
    )
}

fn store_of(reader: &dyn LoadReader) -> FileStore<'_> {
    FileStore::new(reader).expect("the store builds")
}

fn short_rules(reporter: &Reporter) -> Vec<String> {
    reporter
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

/// The diagnostics as the printer writes them: `file:line:column: error rule: message Fix: fix.`
fn printed(store: &FileStore<'_>, reporter: &Reporter) -> Vec<String> {
    reporter
        .diagnostics()
        .iter()
        .map(|diagnostic| {
            let span = reporter
                .locations()
                .get(&diagnostic_location_key(&diagnostic.origin))
                .expect("a located diagnostic");
            let location = store.files().location(*span).expect("inside its file");

            format!(
                "{}:{}:{}: error {}: {}. Fix: {}.",
                location.file,
                location.line,
                location.column,
                diagnostic.rule.as_str(),
                diagnostic.message,
                diagnostic.fix
            )
        })
        .collect()
}

fn parse_one<'run>(
    reader: &'run dyn LoadReader,
    file: &str,
) -> (FileStore<'run>, Reporter, Option<Rc<ParsedFile>>) {
    let mut store = store_of(reader);
    let mut reporter = Reporter::new();
    let parsed = store
        .parse(&mut reporter, file, ROOT_BOUNDARY)
        .expect("no internal error");

    (store, reporter, parsed)
}

fn parse_text(text: &str) -> (FileStore<'static>, Reporter, Option<Rc<ParsedFile>>) {
    // The reader outlives the store through a leak: a few bytes per test, never freed.
    let reader: &'static MemoryReader = Box::leak(Box::new(memory(&[("api.yaml", text)])));

    parse_one(reader, "api.yaml")
}

#[test]
fn the_pitfall_fixtures_print_as_expected() {
    let parse_level = [
        "p1-boolean-case",
        "p1-key",
        "p1-no",
        "p1-yes-on-off",
        "p2-dots",
        "p2-hex-octal-prefix",
        "p2-inf-nan",
        "p2-octal",
        "p2-sign-exp",
        "p3-date-timestamp",
        "p3-sexagesimal",
        "p3-underscore-binary",
        "p4-equals-value",
        "p5-anchor-alias",
        "p5-merge-key",
        "p9-tag",
        "p9-two-documents",
    ];

    for directory in parse_level {
        let base = format!("{PITFALL_FIXTURES}/{directory}");
        let api = fs::read_to_string(format!("{base}/api.yaml")).expect("a fixture file");
        let expected = fs::read_to_string(format!("{base}/expected.txt")).expect("a fixture file");
        let reader = memory(&[("api.yaml", &api)]);
        let (store, reporter, _) = parse_one(&reader, "api.yaml");

        assert_eq!(
            printed(&store, &reporter).join("\n"),
            expected.trim_end(),
            "fixture {directory}"
        );
    }
}

#[test]
fn every_line_of_a_diagnostic_names_file_line_column_rule_and_fix() {
    let (store, reporter, _) = parse_text("a: yes\nb: on\n");

    for line in printed(&store, &reporter) {
        assert!(
            line.starts_with("api.yaml:")
                && line.contains(": error seampact/load/yaml-boolean: ")
                && line.contains(" Fix: "),
            "{line}"
        );
    }
}

#[test]
fn all_parse_errors_are_reported_in_one_run_in_order() {
    let (store, reporter, _) =
        parse_text("a: 1\nb: 2\nc: yes\nd: no\ne: on\nf: off\ng: y\nh: n\ni: Yes\n");
    let lines: Vec<u32> = reporter
        .diagnostics()
        .iter()
        .map(|diagnostic| {
            let span = reporter
                .locations()
                .get(&diagnostic_location_key(&diagnostic.origin))
                .expect("located");

            store.files().location(*span).expect("inside").line
        })
        .collect();

    assert_eq!(lines, [3, 4, 5, 6, 7, 8, 9]);
}

fn layer_of_the_first_diagnostic(layer: FileLayer) -> seampact_diagnostics::DiagnosticLayer {
    let reader = memory(&[("a.yaml", "summary: yes\n")]);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();

    reporter.layer = layer;
    store
        .parse(&mut reporter, "a.yaml", ROOT_BOUNDARY)
        .expect("no internal error");

    reporter.diagnostics()[0].origin.layer.clone()
}

#[test]
fn a_parse_diagnostic_carries_the_layer_of_the_file_parsed() {
    use seampact_diagnostics::DiagnosticLayer;

    assert_eq!(
        layer_of_the_first_diagnostic(FileLayer::Workspace),
        DiagnosticLayer::Workspace
    );
    assert_eq!(
        layer_of_the_first_diagnostic(FileLayer::Api(ApiLayer::Api)),
        DiagnosticLayer::Api
    );
    assert_eq!(
        layer_of_the_first_diagnostic(FileLayer::Api(ApiLayer::Shared)),
        DiagnosticLayer::Shared
    );
    assert_eq!(
        layer_of_the_first_diagnostic(FileLayer::Api(ApiLayer::Base)),
        DiagnosticLayer::Base
    );
    assert_eq!(
        layer_of_the_first_diagnostic(FileLayer::Api(ApiLayer::Pack(PackName::new(
            "p".to_owned()
        )))),
        DiagnosticLayer::Pack("p".to_owned())
    );
}

#[test]
fn a_syntax_error_has_no_root_and_one_diagnostic() {
    let (_, reporter, parsed) = parse_text("a: [1, 2\nb: 3\n");

    assert_eq!(short_rules(&reporter), ["yaml-syntax"]);
    assert!(
        reporter.diagnostics()[0]
            .message
            .starts_with("YAML syntax error: ")
    );
    assert!(parsed.expect("a parsed file").root.is_none());
}

#[test]
fn a_second_document_keeps_the_first_and_is_walked() {
    let (_, reporter, parsed) = parse_text("a: yes\n---\nb: [\n");

    assert_eq!(short_rules(&reporter), ["yaml-document", "yaml-boolean"]);
    assert!(parsed.expect("parsed").root.is_some());
}

#[test]
fn the_document_problem_runs_from_the_marker_to_the_end_of_the_text() {
    let (store, reporter, _) = parse_text("a: 1\n---\nb: 2\n");
    let span = reporter
        .locations()
        .values()
        .next()
        .copied()
        .expect("a located diagnostic");
    let location = store.files().location(span).expect("inside");

    assert_eq!((location.line, location.column), (2, 1));
    assert_eq!((location.end_line, location.end_column), (4, 1));
}

#[test]
fn an_empty_file_has_no_root_and_no_diagnostic() {
    let (_, reporter, parsed) = parse_text("");

    assert!(reporter.is_empty());
    assert!(parsed.expect("parsed").root.is_none());
}

#[test]
fn a_missing_file_parses_to_none_and_is_touched() {
    let reader = memory(&[]);
    let (store, reporter, parsed) = parse_one(&reader, "nope.yaml");

    assert!(parsed.is_none());
    assert!(reporter.is_empty());
    assert!(store.touched().contains("nope.yaml"));
}

#[test]
fn a_file_is_read_and_parsed_once() {
    let reader = SpyReader::new(memory(&[("api.yaml", "a: yes\n")]));
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let first = store
        .parse(&mut reporter, "api.yaml", ROOT_BOUNDARY)
        .expect("ok")
        .expect("parsed");
    let second = store
        .parse(&mut reporter, "api.yaml", ROOT_BOUNDARY)
        .expect("ok")
        .expect("parsed");

    assert!(Rc::ptr_eq(&first, &second));
    assert_eq!(reporter.len(), 1);
    assert_eq!(*reader.reads.borrow(), ["api.yaml"]);
}

#[test]
fn a_file_parsed_for_another_boundary_is_parsed_again_but_reported_once() {
    let reader = memory(&[("pack/p.yaml", "a: yes\n")]);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let root = store
        .parse(&mut reporter, "pack/p.yaml", ROOT_BOUNDARY)
        .expect("ok")
        .expect("parsed");
    let in_package = store
        .parse(&mut reporter, "pack/p.yaml", "pack")
        .expect("ok")
        .expect("parsed");

    assert!(!Rc::ptr_eq(&root, &in_package));
    assert_eq!(in_package.boundary, "pack");
    assert_eq!(reporter.len(), 1);
}

#[test]
fn an_anchor_an_alias_and_a_merge_key_are_refused_with_p5() {
    let (_, reporter, _) = parse_text("a: &x 1\nb: *x\n<<: {c: 1}\n");

    assert_eq!(
        short_rules(&reporter),
        ["yaml-anchor", "yaml-anchor", "yaml-anchor"]
    );
    assert!(reporter.diagnostics()[0].message.contains("anchor '&x'"));
    assert!(reporter.diagnostics()[1].message.contains("alias '*x'"));
    assert!(reporter.diagnostics()[2].message.contains("merge key '<<'"));
}

#[test]
fn a_tagged_scalar_is_refused_and_not_checked_for_pitfalls() {
    let (_, reporter, _) = parse_text("a: !!str yes\n");

    assert_eq!(short_rules(&reporter), ["yaml-tag"]);
    assert!(reporter.diagnostics()[0].message.contains("tag '!!str'"));
}

#[test]
fn a_quoted_scalar_and_a_plain_near_miss_are_accepted() {
    let (_, reporter, _) = parse_text("a: 'yes'\nb: \"on\"\nc: yesterday\nd: 12\ne: true\nf: ~\n");

    assert!(
        reporter.is_empty(),
        "{:?}",
        printed(&parse_text("").0, &reporter)
    );
}

#[test]
fn a_shown_scalar_is_cut_at_37_utf16_units_past_40() {
    let at_the_limit = format!("2027-06-30 {}", "x".repeat(29));
    let past_the_limit = format!("2027-06-30 {}", "x".repeat(30));

    assert_eq!(shown_source(&at_the_limit), at_the_limit);
    assert_eq!(
        shown_source(&past_the_limit),
        format!("2027-06-30 {}...", "x".repeat(26))
    );
}

#[test]
fn a_shown_scalar_cut_inside_an_astral_character_shows_a_replacement() {
    // 36 units, then a character of two: the cut at 37 falls inside it.
    let source = format!("{}😀{}", "x".repeat(36), "y".repeat(10));

    assert_eq!(
        shown_source(&source),
        format!("{}\u{FFFD}...", "x".repeat(36))
    );

    // One unit earlier the astral character fits whole: 35 + 2 = 37.
    let fits = format!("{}😀{}", "x".repeat(35), "y".repeat(10));

    assert_eq!(shown_source(&fits), format!("{}😀...", "x".repeat(35)));
}

#[test]
fn a_long_p3_message_names_the_shown_form_in_the_message_and_the_fix() {
    let source = format!("2027-06-30 {}", "z".repeat(60));
    let (_, reporter, _) = parse_text(&format!("a: {source}\n"));
    let shown = shown_source(&source);

    assert!(
        reporter.diagnostics()[0]
            .message
            .contains(&format!("plain '{shown}'"))
    );
    assert_eq!(
        reporter.diagnostics()[0].fix,
        format!("quote it ('{shown}')")
    );
}

fn nested_blocks(depth: usize) -> String {
    let mut lines: Vec<String> = (0..depth)
        .map(|level| format!("{}a:", " ".repeat(level * 2)))
        .collect();

    lines.push(format!("{}z: 1", " ".repeat(depth * 2)));

    format!("{}\n", lines.join("\n"))
}

#[test]
fn nesting_past_the_limit_is_one_located_too_deep_not_a_crash() {
    let (store, reporter, parsed) = parse_text(&nested_blocks(300));

    assert_eq!(short_rules(&reporter), ["too-deep"]);
    assert!(parsed.expect("parsed").root.is_some());

    let printed = printed(&store, &reporter);

    // The first node past the limit is the mapping written at depth 257: 128 pairs down, then
    // the key of the 129th ... line 129 is the 129th `a:` at column 257.
    assert!(printed[0].starts_with("api.yaml:"), "{}", printed[0]);
}

#[test]
fn nesting_at_the_limit_is_accepted() {
    // 255 nested mappings put the leaf key and value at depth 256, the limit.
    let (_, reporter, _) = parse_text(&nested_blocks(255));

    assert!(reporter.is_empty(), "{:?}", short_rules(&reporter));
}

#[test]
fn one_more_pair_than_the_limit_allows_is_too_deep() {
    // 256 nested mappings put the leaf key at depth 257: one level past the limit.
    let (_, reporter, _) = parse_text(&nested_blocks(256));

    assert_eq!(short_rules(&reporter), ["too-deep"]);
}

#[test]
fn too_deep_is_reported_once_per_file() {
    let reader = memory(&[
        ("a.yaml", &nested_blocks(300)),
        ("b.yaml", &nested_blocks(300)),
    ]);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();

    for file in ["a.yaml", "b.yaml"] {
        store.parse(&mut reporter, file, ROOT_BOUNDARY).expect("ok");
    }

    assert_eq!(short_rules(&reporter), ["too-deep", "too-deep"]);
}

#[test]
fn a_flow_nesting_past_the_parser_limit_is_too_deep_at_the_marker() {
    let (store, reporter, _) = parse_text(&format!("{}{}\n", "[".repeat(300), "]".repeat(300)));

    assert_eq!(short_rules(&reporter), ["too-deep"]);

    let line = &printed(&store, &reporter)[0];

    // The parser refuses the 256th nested `[`; the TypeScript reports the node of depth 257, a
    // difference to record as `too-deep-flow-column`.
    assert!(line.starts_with("api.yaml:1:"), "{line}");
}

#[test]
fn a_file_larger_than_the_cap_is_refused_unread_and_located_at_1_1() {
    let big = format!("k: '{}'\n", "x".repeat(4 * 1024 * 1024));
    let reader = SpyReader::new(memory(&[("big.yaml", &big)]));
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let parsed = store
        .parse(&mut reporter, "big.yaml", ROOT_BOUNDARY)
        .expect("ok");

    assert!(parsed.is_none());
    assert_eq!(short_rules(&reporter), ["file-too-large"]);
    assert!(
        printed(&store, &reporter)[0]
            .starts_with("big.yaml:1:1: error seampact/load/file-too-large: ")
    );
    assert!(reporter.diagnostics()[0].message.contains("4194304 bytes"));
}

#[test]
fn a_second_ask_for_a_too_large_file_reads_and_reports_nothing_more() {
    let big = "x".repeat(4 * 1024 * 1024 + 1);
    let reader = SpyReader::new(memory(&[("big.yaml", &big)]));
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();

    for _ in 0..2 {
        assert_eq!(store.raw_text(&mut reporter, "big.yaml").expect("ok"), None);
    }

    assert_eq!(reporter.len(), 1);
    assert_eq!(reader.reads.borrow().len(), 1);
}

#[test]
fn a_byte_order_mark_and_carriage_returns_are_normalised_before_the_parse() {
    let (store, reporter, parsed) = parse_text("\u{FEFF}a: yes\r\nb: 1\r\n");
    let parsed = parsed.expect("parsed");

    assert_eq!(store.text_of(parsed.file), Some("a: yes\nb: 1\n"));
    assert_eq!(printed(&store, &reporter).len(), 1);
    assert!(printed(&store, &reporter)[0].starts_with("api.yaml:1:4: "));
}

/// A reader that records every read and listing, to see what the store asks of the disk.
struct SpyReader {
    inner: MemoryReader,
    reads: RefCell<Vec<String>>,
    listed: RefCell<Vec<String>>,
}

impl SpyReader {
    fn new(inner: MemoryReader) -> Self {
        Self {
            inner,
            reads: RefCell::new(Vec::new()),
            listed: RefCell::new(Vec::new()),
        }
    }
}

impl LoadReader for SpyReader {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        self.reads.borrow_mut().push(file.to_owned());

        self.inner.read_text(file, max_bytes)
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        self.listed.borrow_mut().push(dir.to_owned());

        self.inner.list_dir(dir)
    }

    fn real_path(&self, file: &str) -> Option<String> {
        self.inner.real_path(file)
    }

    fn ascent(&self) -> u32 {
        self.inner.ascent()
    }
}

fn resolve_from_api<'run>(
    reader: &'run dyn LoadReader,
    raw: &str,
    kind: FileKind,
) -> (FileStore<'run>, Reporter, Option<ResolvedFile>) {
    let mut store = store_of(reader);
    let mut reporter = Reporter::new();
    let from = PathContext {
        path: "api.yaml",
        boundary: ROOT_BOUNDARY,
    };
    let at = store.unread_file_span("api.yaml").expect("a span");
    let resolved = store
        .resolve(&mut reporter, from, raw, at, kind)
        .expect("no internal error");

    (store, reporter, resolved)
}

#[test]
fn a_path_that_passes_every_check_gives_its_real_path_and_fragment() {
    let reader = memory(&[("api.yaml", ""), ("parts/a.yaml", "k: 1\n")]);
    let (store, reporter, resolved) =
        resolve_from_api(&reader, "./parts/a.yaml#/Name", FileKind::Include);

    assert!(reporter.is_empty());
    assert_eq!(
        resolved,
        Some(ResolvedFile {
            path: "parts/a.yaml".to_owned(),
            real: "parts/a.yaml".to_owned(),
            fragment: Some("/Name".to_owned()),
        })
    );
    assert_eq!(store.real_of("parts/a.yaml"), "parts/a.yaml");
    assert!(store.touched().contains("parts/a.yaml"));
}

#[test]
fn an_authored_path_is_refused_with_its_rule_and_message() {
    let reader = memory(&[("api.yaml", "")]);
    let table = [
        (
            "",
            FileKind::Include,
            "path-empty",
            "$include names no file",
        ),
        (
            "a\\b.yaml",
            FileKind::Ref,
            "path-backslash",
            "path 'a\\b.yaml' of $ref uses a backslash",
        ),
        (
            "/etc/x",
            FileKind::File,
            "path-absolute",
            "path '/etc/x' of $file is absolute",
        ),
        (
            "../x.yaml",
            FileKind::Extends,
            "path-escape",
            "path '../x.yaml' of extends leaves the workspace root",
        ),
    ];

    for (raw, kind, rule, message) in table {
        let (_, reporter, resolved) = resolve_from_api(&reader, raw, kind);

        assert_eq!(resolved, None, "{raw}");
        assert_eq!(short_rules(&reporter), [rule], "{raw}");
        assert_eq!(reporter.diagnostics()[0].message, message, "{raw}");
    }
}

#[test]
fn an_escape_from_a_pack_names_its_package() {
    let reader = memory(&[("pkg/p.yaml", "")]);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let from = PathContext {
        path: "pkg/p.yaml",
        boundary: "pkg",
    };
    let at = store.unread_file_span("pkg/p.yaml").expect("a span");
    let resolved = store
        .resolve(&mut reporter, from, "../other.yaml", at, FileKind::Pack)
        .expect("ok");

    assert_eq!(resolved, None);
    assert_eq!(
        reporter.diagnostics()[0].message,
        "path '../other.yaml' of packs leaves the pack's package (pkg)"
    );
}

#[test]
fn a_missing_file_is_reported_where_it_is_named() {
    let reader = memory(&[("api.yaml", "")]);
    let (_, reporter, resolved) = resolve_from_api(&reader, "./nope.yaml", FileKind::Include);

    assert_eq!(resolved, None);
    assert_eq!(short_rules(&reporter), ["file-missing"]);
    assert_eq!(
        reporter.diagnostics()[0].message,
        "file 'nope.yaml' named by $include does not exist"
    );
}

#[test]
fn a_path_that_differs_in_case_names_the_disk_spelling() {
    let reader = memory(&[("api.yaml", ""), ("Parts/A.yaml", "")]);
    let (_, reporter, resolved) = resolve_from_api(&reader, "./parts/a.yaml", FileKind::Include);

    assert_eq!(resolved, None);
    assert_eq!(short_rules(&reporter), ["path-case"]);
    assert_eq!(
        reporter.diagnostics()[0].message,
        "path './parts/a.yaml' of $include differs in case from the file on disk, 'Parts/A.yaml'"
    );
}

#[test]
fn a_link_out_of_the_root_is_an_escape_that_never_names_the_target_and_lists_nothing_through_it() {
    let inner = memory(&[("api.yaml", ""), ("../secret/deep/x.yaml", "k: 1\n")])
        .with_links([("out".to_owned(), "../secret".to_owned())]);
    let reader = SpyReader::new(inner);
    let (_, reporter, resolved) = resolve_from_api(&reader, "./out/deep/x.yaml", FileKind::Include);

    assert_eq!(resolved, None);
    assert_eq!(short_rules(&reporter), ["path-escape"]);
    assert!(!reporter.diagnostics()[0].message.contains("secret"));
    assert!(
        reader
            .listed
            .borrow()
            .iter()
            .all(|directory| !directory.starts_with("out")),
        "{:?}",
        reader.listed.borrow()
    );
}

#[test]
fn the_checked_real_path_is_the_one_read() {
    let inner = memory(&[("api.yaml", "a: 1\n"), ("real.yaml", "k: 1\n")])
        .with_links([("link.yaml".to_owned(), "real.yaml".to_owned())]);
    let reader = SpyReader::new(inner);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();

    store
        .parse(&mut reporter, "api.yaml", ROOT_BOUNDARY)
        .expect("ok");

    let from = PathContext {
        path: "api.yaml",
        boundary: ROOT_BOUNDARY,
    };
    let at = store.unread_file_span("api.yaml").expect("a span");
    let resolved = store
        .resolve(&mut reporter, from, "./link.yaml", at, FileKind::Include)
        .expect("ok")
        .expect("resolved");

    assert_eq!(resolved.real, "real.yaml");
    assert_eq!(store.real_of("link.yaml"), "real.yaml");

    store
        .parse(&mut reporter, &resolved.path, ROOT_BOUNDARY)
        .expect("ok");

    assert!(reporter.is_empty());
    assert_eq!(*reader.reads.borrow(), ["api.yaml", "real.yaml"]);
}

#[test]
fn a_path_that_resolved_once_is_not_checked_again() {
    let reader = SpyReader::new(memory(&[("api.yaml", ""), ("parts/a.yaml", "")]));
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let from = PathContext {
        path: "api.yaml",
        boundary: ROOT_BOUNDARY,
    };
    let at = store.unread_file_span("api.yaml").expect("a span");

    for _ in 0..3 {
        store
            .resolve(&mut reporter, from, "./parts/a.yaml", at, FileKind::Include)
            .expect("ok");
    }

    let listings = reader.listed.borrow().len();

    assert_eq!(
        listings,
        2,
        "the root and parts, once each: {:?}",
        reader.listed.borrow()
    );
}

#[test]
fn a_probe_for_a_missing_file_reports_nothing() {
    let reader = memory(&[("api.yaml", "")]);
    let mut store = store_of(&reader);
    let mut reporter = Reporter::new();
    let at = store.unread_file_span("api.yaml").expect("a span");
    let found = store
        .check_file(
            &mut reporter,
            "node_modules/x/package.json",
            ROOT_BOUNDARY,
            at,
            "packs",
            "node_modules/x/package.json",
            OnMissing::Return,
        )
        .expect("ok");

    assert_eq!(found, CheckedFile::Missing);
    assert!(reporter.is_empty());
    assert!(store.touched().contains("node_modules/x/package.json"));
}

#[test]
fn an_unread_file_span_is_empty_at_the_start_and_one_per_path() {
    let reader = memory(&[]);
    let mut store = store_of(&reader);
    let first = store.unread_file_span("gone.yaml").expect("a span");
    let again = store.unread_file_span("gone.yaml").expect("a span");
    let location = store.files().location(first).expect("inside");

    assert_eq!(first, again);
    assert_eq!(
        (
            location.file.as_str(),
            location.line,
            location.column,
            location.end_line,
            location.end_column
        ),
        ("gone.yaml", 1, 1, 1, 1)
    );
}

#[test]
fn node_and_pair_spans_follow_the_package_rules() {
    let reader = memory(&[("api.yaml", "{a: 1, b}\n")]);
    let (store, _, parsed) = parse_one(&reader, "api.yaml");
    let parsed = parsed.expect("parsed");
    let Some(YamlNode {
        kind: YamlKind::Mapping(pairs),
        ..
    }) = &parsed.root
    else {
        panic!("a mapping");
    };
    let located = |span: Span| {
        let location = store.files().location(span).expect("inside");

        (location.column, location.end_column)
    };

    assert_eq!(located(node_span(&parsed, parsed.root.as_ref())), (1, 10));
    assert_eq!(located(node_span(&parsed, None)), (1, 1));
    assert_eq!(
        located(pair_span(
            &parsed,
            Some(&pairs[0].key),
            pairs[0].value.as_ref()
        )),
        (2, 6)
    );
    // No value: the pair ends where its key does.
    assert_eq!(
        located(pair_span(&parsed, Some(&pairs[1].key), None)),
        (8, 9)
    );
    assert_eq!(
        located(pair_span(&parsed, None, pairs[0].value.as_ref())),
        (5, 6)
    );
    assert_eq!(located(pair_span(&parsed, None, None)), (1, 1));
}

#[test]
fn a_file_kind_reads_as_the_word_that_names_it() {
    let words: Vec<&str> = [
        FileKind::Include,
        FileKind::Ref,
        FileKind::File,
        FileKind::Extends,
        FileKind::Pack,
        FileKind::Workspace,
        FileKind::Manifest,
    ]
    .into_iter()
    .map(FileKind::what)
    .collect();

    assert_eq!(
        words,
        [
            "$include",
            "$ref",
            "$file",
            "extends",
            "packs",
            "workspace",
            "seampact.pack"
        ]
    );
}

mod round_trip {
    use proptest::prelude::*;

    use super::*;

    const NAMES: [&str; 10] = [
        "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    ];

    /// The trees of the TypeScript property test: nested mappings of numbers, texts, booleans and
    /// pairs of numbers.
    #[derive(Debug, Clone)]
    enum Generated {
        Whole(u16),
        Text(u8),
        Flag(bool),
        Pair(u8, u8),
        Mapping(Vec<(&'static str, Generated)>),
    }

    fn keys_of(count: std::ops::RangeInclusive<usize>) -> impl Strategy<Value = Vec<&'static str>> {
        prop::sample::subsequence(NAMES.to_vec(), count).prop_shuffle()
    }

    fn leaf() -> impl Strategy<Value = Generated> {
        prop_oneof![
            (0u16..1000).prop_map(Generated::Whole),
            (0u8..100).prop_map(Generated::Text),
            any::<bool>().prop_map(Generated::Flag),
            (0u8..9, 0u8..9).prop_map(|(first, second)| Generated::Pair(first, second)),
        ]
    }

    fn mapping(depth: u32) -> BoxedStrategy<Generated> {
        let value = if depth == 0 {
            leaf().boxed()
        } else {
            prop_oneof![
                2 => leaf(),
                1 => mapping(depth - 1),
            ]
            .boxed()
        };

        keys_of(1..=5)
            .prop_flat_map(move |keys| {
                let count = keys.len();

                (Just(keys), prop::collection::vec(value.clone(), count))
            })
            .prop_map(|(keys, values)| Generated::Mapping(keys.into_iter().zip(values).collect()))
            .boxed()
    }

    /// Block YAML, leaves as `JSON.stringify` writes them.
    fn emit(generated: &Generated, indent: usize, lines: &mut Vec<String>) {
        let Generated::Mapping(members) = generated else {
            return;
        };
        let padding = " ".repeat(indent);

        for (key, member) in members {
            match member {
                Generated::Mapping(_) => {
                    lines.push(format!("{padding}{key}:"));
                    emit(member, indent + 2, lines);
                }
                leaf => lines.push(format!("{padding}{key}: {}", written(leaf))),
            }
        }
    }

    fn written(leaf: &Generated) -> String {
        match leaf {
            Generated::Whole(number) => number.to_string(),
            Generated::Text(number) => format!("\"text {number}\""),
            Generated::Flag(flag) => flag.to_string(),
            Generated::Pair(first, second) => format!("[{first},{second}]"),
            Generated::Mapping(_) => String::new(),
        }
    }

    fn assert_same(generated: &Generated, node: &YamlNode, text: &str) {
        match (generated, &node.kind) {
            (Generated::Mapping(members), YamlKind::Mapping(pairs)) => {
                assert_eq!(members.len(), pairs.len());

                for ((key, member), pair) in members.iter().zip(pairs) {
                    assert_eq!(pair.key.scalar_text(), Some(*key));

                    let value = pair.value.as_ref().expect("a value");

                    assert_same(member, value, text);
                }
            }
            (Generated::Pair(first, second), YamlKind::Sequence(items)) => {
                let read: Vec<String> = items
                    .iter()
                    .map(|item| item.resolved_scalar().expect("a scalar").to_js_string())
                    .collect();

                assert_eq!(read, [first.to_string(), second.to_string()]);
                assert_eq!(span_text(node, text), written(generated));
            }
            (leaf, YamlKind::Scalar { .. }) => {
                let resolved = node.resolved_scalar().expect("a scalar");
                let expected = match leaf {
                    Generated::Whole(number) => number.to_string(),
                    Generated::Text(number) => format!("text {number}"),
                    Generated::Flag(flag) => flag.to_string(),
                    _ => panic!("a scalar for {leaf:?}"),
                };

                assert_eq!(resolved.to_js_string(), expected);
                assert_eq!(span_text(node, text), written(leaf));
            }
            (other, kind) => panic!("{other:?} read as {kind:?}"),
        }
    }

    fn span_text<'text>(node: &YamlNode, text: &'text str) -> &'text str {
        let range = node.span.range;

        text.get(usize::from(range.start())..usize::from(range.end()))
            .expect("a span on character boundaries")
    }

    proptest! {
        // CHK-109 at the YAML level: a generated tree, written as block YAML, reads back as the
        // same tree, keys in the order written, every node's span holding the text written.
        #[test]
        fn a_generated_tree_reads_back_with_its_order_and_its_spans(tree in mapping(3)) {
            let mut lines = Vec::new();

            emit(&tree, 0, &mut lines);

            let text = format!("{}\n", lines.join("\n"));
            let (_, reporter, parsed) = parse_text(&text);
            let root = parsed.expect("parsed").root.clone().expect("a root");

            prop_assert!(reporter.is_empty(), "{:?}", short_rules(&reporter));
            assert_same(&tree, &root, &text);
        }
    }
}
