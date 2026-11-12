//! The printer, the sort and the location key, as the TypeScript `print.test.ts` checks them.

use indexmap::IndexMap;
use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, DiagnosticSink, RelatedLocation, RuleId,
    Severity, diagnostic_location, diagnostic_sort, print_diagnostics,
};
use seampact_span::Location;

fn site(file: &str, line: u32, column: u32) -> Location {
    Location {
        file: file.to_owned(),
        line,
        column,
        end_line: line,
        end_column: column + 1,
    }
}

fn table(entries: &[(&str, Location)]) -> IndexMap<String, Location> {
    entries
        .iter()
        .map(|(key, location)| ((*key).to_owned(), location.clone()))
        .collect()
}

fn locations() -> IndexMap<String, Location> {
    table(&[
        (
            "api#/surfaces/app/routes/exportTasks",
            site("tasks/api.yaml", 42, 9),
        ),
        ("api#/b", site("tasks/api.yaml", 42, 9)),
        ("api#/c", site("tasks/api.yaml", 7, 3)),
        ("base#/d", site("base.yaml", 99, 1)),
        ("api#/e", site("tasks/api.yaml", 42, 10)),
    ])
}

fn origin(layer: DiagnosticLayer, pointer: &str) -> DiagnosticOrigin {
    DiagnosticOrigin {
        api: None,
        layer,
        pointer: pointer.to_owned(),
    }
}

fn diagnostic(rule: &str, pointer: &str, layer: DiagnosticLayer) -> Diagnostic {
    Diagnostic {
        severity: Severity::Error,
        rule: RuleId::new(rule.to_owned()),
        message: "m".to_owned(),
        fix: "f".to_owned(),
        origin: origin(layer, pointer),
        related: Vec::new(),
    }
}

fn lines(printed: &str) -> Vec<&str> {
    printed.split('\n').collect()
}

#[test]
fn the_printer_writes_the_adr_line_byte_for_byte() {
    let adr = Diagnostic {
        message: "route 'exportTasks' has no identity and no public access".to_owned(),
        fix: "set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'"
            .to_owned(),
        ..diagnostic(
            "seampact/access/deny-by-default",
            "/surfaces/app/routes/exportTasks",
            DiagnosticLayer::Api,
        )
    };

    assert_eq!(
        print_diagnostics(std::slice::from_ref(&adr), &locations()),
        "tasks/api.yaml:42:9: error seampact/access/deny-by-default: route 'exportTasks' has no identity and no public access. Fix: set 'identity: <name>' on it or an ancestor, or 'access: { public: \"<reason>\" }'."
    );

    let dotted = Diagnostic {
        message: format!("{}.", adr.message),
        fix: format!("{}.", adr.fix),
        ..adr.clone()
    };

    assert_eq!(
        print_diagnostics(&[dotted], &locations()),
        print_diagnostics(&[adr], &locations())
    );
}

#[test]
fn the_printer_sorts_by_file_line_column_then_rule_with_related_below() {
    let with_related = Diagnostic {
        related: vec![RelatedLocation {
            origin: origin(DiagnosticLayer::Base, "/d"),
            message: "first declared here".to_owned(),
        }],
        ..diagnostic("seampact/load/z", "/b", DiagnosticLayer::Api)
    };
    let api_scoped = Diagnostic {
        origin: DiagnosticOrigin {
            api: Some("tasks".to_owned()),
            ..origin(DiagnosticLayer::Api, "/e")
        },
        ..diagnostic("seampact/load/api-scoped", "/e", DiagnosticLayer::Api)
    };
    let printed = print_diagnostics(
        &[
            diagnostic("seampact/load/z-last", "/b", DiagnosticLayer::Api),
            with_related,
            diagnostic("seampact/load/a-first", "/b", DiagnosticLayer::Api),
            diagnostic("seampact/load/any", "/d", DiagnosticLayer::Base),
            diagnostic("seampact/load/c", "/c", DiagnosticLayer::Api),
            api_scoped,
        ],
        &locations(),
    );

    assert_eq!(
        lines(&printed),
        [
            "base.yaml:99:1: error seampact/load/any: m. Fix: f.",
            "tasks/api.yaml:7:3: error seampact/load/c: m. Fix: f.",
            "tasks/api.yaml:42:9: error seampact/load/a-first: m. Fix: f.",
            "tasks/api.yaml:42:9: error seampact/load/z: m. Fix: f.",
            "  base.yaml:99:1: first declared here.",
            "tasks/api.yaml:42:9: error seampact/load/z-last: m. Fix: f.",
            "tasks/api.yaml:42:10: error seampact/load/api-scoped: m. Fix: f.",
        ]
    );
    assert!(!printed.contains('\u{1B}'));
}

#[test]
fn the_sort_is_the_same_whatever_the_input_order() {
    let list = vec![
        diagnostic("seampact/load/b", "/c", DiagnosticLayer::Api),
        diagnostic("seampact/load/a", "/b", DiagnosticLayer::Api),
        diagnostic("seampact/load/c", "/d", DiagnosticLayer::Base),
    ];
    let mut reversed = list.clone();
    reversed.reverse();

    let forward = diagnostic_sort(list, &locations());
    let backward = diagnostic_sort(reversed, &locations());

    assert_eq!(forward, backward);
}

#[test]
fn the_sort_keeps_the_emit_order_of_full_ties() {
    let first = Diagnostic {
        fix: "first".to_owned(),
        ..diagnostic("seampact/load/a", "/b", DiagnosticLayer::Api)
    };
    let second = Diagnostic {
        fix: "second".to_owned(),
        ..first.clone()
    };
    let sorted = diagnostic_sort(vec![first.clone(), second.clone()], &locations());

    assert_eq!(sorted, [first, second]);
}

#[test]
fn files_and_rules_sort_in_utf16_order() {
    // U+FF5E sorts after U+1F600 in code points but before it in UTF-16 units.
    let entries = table(&[
        ("api#/astral", site("\u{1F600}.yaml", 1, 1)),
        ("api#/bmp", site("\u{FF5E}.yaml", 1, 1)),
    ]);
    let sorted = diagnostic_sort(
        vec![
            diagnostic("seampact/load/x", "/bmp", DiagnosticLayer::Api),
            diagnostic("seampact/load/x", "/astral", DiagnosticLayer::Api),
        ],
        &entries,
    );
    let pointers: Vec<&str> = sorted
        .iter()
        .map(|item| item.origin.pointer.as_str())
        .collect();

    assert_eq!(pointers, ["/astral", "/bmp"]);
}

#[test]
fn the_location_key_is_the_layer_and_pointer_never_the_api() {
    let api_scoped = DiagnosticOrigin {
        api: Some("tasks".to_owned()),
        ..origin(DiagnosticLayer::Api, "/e")
    };
    let table_locations = locations();
    let found = diagnostic_location(&api_scoped, &table_locations);

    assert_eq!(
        (found.file, found.line, found.column),
        ("tasks/api.yaml", 42, 10)
    );
    assert_eq!(
        diagnostic_location(&origin(DiagnosticLayer::Api, "/missing"), &table_locations).file,
        "(unknown location)"
    );
    assert_eq!(
        diagnostic_location(&origin(DiagnosticLayer::Api, "/toString"), &IndexMap::new()).file,
        "(unknown location)"
    );

    let old_and_new = table(&[
        ("tasks:api#/e", site("old.yaml", 1, 1)),
        ("api#/e", site("new.yaml", 2, 2)),
    ]);
    let old_only = table(&[("tasks:api#/e", site("old.yaml", 1, 1))]);

    assert_eq!(
        diagnostic_location(&api_scoped, &old_and_new).file,
        "new.yaml"
    );
    assert_eq!(
        diagnostic_location(&api_scoped, &old_only).file,
        "(unknown location)"
    );
}

#[test]
fn a_pack_layer_is_keyed_by_its_name() {
    let entries = table(&[("pack:./p.yaml#/a", site("p.yaml", 3, 4))]);
    let found = diagnostic_location(
        &origin(DiagnosticLayer::Pack("./p.yaml".to_owned()), "/a"),
        &entries,
    );

    assert_eq!((found.file, found.line, found.column), ("p.yaml", 3, 4));
}

#[test]
fn the_printer_escapes_every_control_and_format_character() {
    let cases = [
        ("\u{061C}", "\\u061C"),
        ("\u{200B}", "\\u200B"),
        ("\u{200C}", "\\u200C"),
        ("\u{200D}", "\\u200D"),
        ("\u{2060}", "\\u2060"),
        ("\u{2061}", "\\u2061"),
        ("\u{2062}", "\\u2062"),
        ("\u{2063}", "\\u2063"),
        ("\u{2064}", "\\u2064"),
        ("\u{00AD}", "\\u00AD"),
        ("\u{E0041}", "\\u{E0041}"),
    ];

    for (character, shown) in cases {
        let item = Diagnostic {
            message: format!("a{character}b"),
            ..diagnostic("seampact/load/x", "/t", DiagnosticLayer::Api)
        };
        let entries = table(&[("api#/t", site(&format!("f{character}.yaml"), 1, 1))]);

        assert_eq!(
            print_diagnostics(&[item], &entries),
            format!("f{shown}.yaml:1:1: error seampact/load/x: a{shown}b. Fix: f."),
            "{shown}"
        );
    }

    // A file name keeps the byte order mark escaped; a message folds it as white space.
    let entries = table(&[("api#/t", site("\u{FEFF}f.yaml", 1, 1))]);

    assert_eq!(
        print_diagnostics(
            &[diagnostic("seampact/load/x", "/t", DiagnosticLayer::Api)],
            &entries
        ),
        "\\uFEFFf.yaml:1:1: error seampact/load/x: m. Fix: f."
    );
}

#[test]
fn the_printer_escapes_control_and_bidirectional_characters_of_authored_text() {
    let escape = '\u{1B}';
    let entries = table(&[
        ("api#/t", site(&format!("a{escape}[2Jb\u{202E}.yaml"), 1, 1)),
        ("api#/r", site("r.yaml", 2, 1)),
    ]);
    let item = Diagnostic {
        message: format!(
            "key '{escape}[31mred\u{7}' \u{200E}hidden\u{2066}\u{2069} \u{9B}1m del\u{7F}"
        ),
        fix: "drop\u{202D}it\u{200F}".to_owned(),
        related: vec![RelatedLocation {
            origin: origin(DiagnosticLayer::Api, "/r"),
            message: format!("here{escape}]0;title"),
        }],
        ..diagnostic("seampact/load/x", "/t", DiagnosticLayer::Api)
    };
    let printed = print_diagnostics(&[item], &entries);

    assert_eq!(
        printed,
        [
            "a\\u001B[2Jb\\u202E.yaml:1:1: error seampact/load/x: key '\\u001B[31mred\\u0007' \\u200Ehidden\\u2066\\u2069 \\u009B1m del\\u007F. Fix: drop\\u202Dit\\u200F.",
            "  r.yaml:2:1: here\\u001B]0;title.",
        ]
        .join("\n")
    );

    let active: Vec<char> = printed
        .chars()
        .filter(|&character| {
            let code = u32::from(character);

            (code <= 0x1F && code != 0x0A)
                || (0x7F..=0x9F).contains(&code)
                || (0x200E..=0x206F).contains(&code)
        })
        .collect();

    assert_eq!(active, []);
}

#[test]
fn a_warning_prints_its_severity() {
    let warning = Diagnostic {
        severity: Severity::Warning,
        ..diagnostic("seampact/lint/x", "/c", DiagnosticLayer::Api)
    };

    assert_eq!(
        print_diagnostics(&[warning], &locations()),
        "tasks/api.yaml:7:3: warning seampact/lint/x: m. Fix: f."
    );
}

#[test]
fn the_sink_keeps_emit_order_and_counts_errors() {
    let mut sink = DiagnosticSink::new();

    sink.report(diagnostic("seampact/load/b", "/c", DiagnosticLayer::Api));
    sink.report(Diagnostic {
        severity: Severity::Warning,
        ..diagnostic("seampact/load/a", "/b", DiagnosticLayer::Api)
    });

    assert_eq!(sink.len(), 2);
    assert_eq!(sink.error_count(), 1);

    let rules: Vec<String> = sink
        .into_diagnostics()
        .iter()
        .map(|item| item.rule.to_string())
        .collect();

    assert_eq!(rules, ["seampact/load/b", "seampact/load/a"]);
}

#[test]
fn layers_print_as_the_typescript_names_them() {
    let layers = [
        (DiagnosticLayer::Api, "api"),
        (DiagnosticLayer::Shared, "shared"),
        (DiagnosticLayer::Base, "base"),
        (DiagnosticLayer::Workspace, "workspace"),
        (DiagnosticLayer::Pack("@acme/p".to_owned()), "pack:@acme/p"),
    ];

    for (layer, text) in layers {
        assert_eq!(layer.to_string(), text);
    }
}
