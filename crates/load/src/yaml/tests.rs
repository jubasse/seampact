use seampact_span::SourceFiles;

use super::*;

const RECORDED_RANGES: &str = include_str!("yaml_package_ranges.txt");
const RECORDED_INPUT_MARKER: &str = "=== ";

fn parse(text: &str) -> YamlDocument {
    let mut files = SourceFiles::new();
    let file = files.add("a.yaml", text).expect("a small text");
    let normalised = files.get(file).expect("the file").text().to_owned();

    parse_yaml(file, &normalised).expect("the parser stays inside the text")
}

fn root_of(text: &str) -> YamlNode {
    let document = parse(text);

    assert_eq!(document.problem, None, "{text:?}");

    document.root.expect("a root node")
}

fn start_end(node: &YamlNode) -> (u32, u32) {
    (
        u32::from(node.span.range.start()),
        u32::from(node.span.range.end()),
    )
}

/// One line per node, in the format of the recorded table.
fn dump(node: &YamlNode, indent: &str, lines: &mut Vec<String>) {
    let (start, end) = start_end(node);
    let anchor = node
        .anchor
        .as_ref()
        .map_or(String::new(), |name| format!(" anchor:{}", name.as_str()));
    let tag = node
        .tag
        .as_ref()
        .map_or(String::new(), |tag| format!(" tag:{tag}"));
    let properties = format!("{anchor}{tag}");

    match &node.kind {
        YamlKind::Mapping(pairs) => {
            lines.push(format!("{indent}map {start}..{end}{properties}"));

            for pair in pairs {
                dump(&pair.key, &format!("{indent}  "), lines);

                match &pair.value {
                    Some(value) => dump(value, &format!("{indent}  "), lines),
                    None => lines.push(format!("{indent}  absent")),
                }
            }
        }
        YamlKind::Sequence(items) => {
            lines.push(format!("{indent}seq {start}..{end}{properties}"));

            for item in items {
                dump(item, &format!("{indent}  "), lines);
            }
        }
        YamlKind::Alias(name) => {
            lines.push(format!("{indent}alias {start}..{end} {:?}", name.as_str()));
        }
        YamlKind::Scalar { value, style } => {
            let style = match style {
                ScalarStyle::Plain => "plain",
                ScalarStyle::Quoted => "quoted",
                ScalarStyle::Block => "block",
            };
            let shown = serde_json::to_string(value).expect("a string");

            lines.push(format!(
                "{indent}scalar {start}..{end} {style}{properties} {shown}"
            ));
        }
    }
}

#[test]
fn ranges_match_the_yaml_package() {
    let mut checked = 0;

    for block in RECORDED_RANGES.split(RECORDED_INPUT_MARKER).skip(1) {
        let (input_line, expected) = block.split_once('\n').expect("an input line");
        let input: String = serde_json::from_str(input_line).expect("a JSON string");
        let mut lines = Vec::new();

        dump(&root_of(&input), "", &mut lines);

        assert_eq!(
            format!("{}\n", lines.join("\n")),
            expected,
            "input {input:?}"
        );

        checked += 1;
    }

    assert!(checked >= 50, "only {checked} recorded inputs");
}

#[test]
fn an_empty_text_has_no_root_and_no_problem() {
    assert_eq!(
        parse(""),
        YamlDocument {
            root: None,
            problem: None
        }
    );
    assert_eq!(parse("# only a comment\n").root, None);
}

#[test]
fn a_syntax_error_has_no_root_and_the_marker() {
    let document = parse("a: [1, 2\nb: 3\n");

    assert_eq!(document.root, None);

    let Some(YamlProblem::Syntax { info, at }) = document.problem else {
        panic!("a syntax problem");
    };

    assert_eq!(info, "illegal placement of ':' indicator");
    assert_eq!(at.range.start(), at.range.end());
}

#[test]
fn a_position_past_the_end_of_the_text_is_clamped_to_the_end() {
    let text = "{a\t#\n%\u{e9}\u{1F600}\u{1F600}";
    // The parser gives an empty scalar the span 5..20 in a text of 10 characters, and then
    // refuses the text: the load answers a syntax problem, not an internal error.
    let document = parse(text);

    assert_eq!(document.root, None);
    assert!(matches!(document.problem, Some(YamlProblem::Syntax { .. })));
}

#[test]
fn a_second_document_keeps_the_first_and_runs_to_the_end_of_the_text() {
    let text = "a: 1\n---\nb: [\n";
    let document = parse(text);
    let Some(YamlProblem::SecondDocument { at }) = document.problem else {
        panic!("a second document");
    };

    assert_eq!(u32::from(at.range.start()), 5);
    assert_eq!(usize::from(at.range.end()), text.len());
    assert!(document.root.is_some());
}

#[test]
fn nested_flow_collections_past_the_parser_limit_are_too_deep() {
    let text = format!("{}{}", "[".repeat(300), "]".repeat(300));

    assert!(matches!(
        parse(&text).problem,
        Some(YamlProblem::TooDeep { .. })
    ));
}

#[test]
fn duplicate_keys_and_key_order_are_kept() {
    let YamlKind::Mapping(pairs) = root_of("b: 1\na: 2\nb: 3\n").kind else {
        panic!("a mapping");
    };
    let keys: Vec<&str> = pairs
        .iter()
        .filter_map(|pair| pair.key.scalar_text())
        .collect();

    assert_eq!(keys, ["b", "a", "b"]);
}

#[test]
fn an_absent_value_is_none_and_an_empty_value_is_a_node() {
    let YamlKind::Mapping(pairs) = root_of("{a, b: , c: d}").kind else {
        panic!("a mapping");
    };

    assert!(pairs[0].value.is_none());
    assert_eq!(
        pairs[1].value.as_ref().and_then(YamlNode::scalar_text),
        Some("")
    );
    assert_eq!(
        pairs[2].value.as_ref().and_then(YamlNode::scalar_text),
        Some("d")
    );
}

#[test]
fn spans_are_bytes_and_locations_are_utf16_columns() {
    let text = "k: \"😀x\"\nz: é\n";
    let mut files = SourceFiles::new();
    let file = files.add("a.yaml", text).expect("a small text");
    let document = parse_yaml(file, text).expect("parses");
    let YamlKind::Mapping(pairs) = document.root.expect("a root").kind else {
        panic!("a mapping");
    };
    let quoted = pairs[0].value.as_ref().expect("a value");
    let accented = pairs[1].value.as_ref().expect("a value");

    assert_eq!(start_end(quoted), (3, 10));
    assert_eq!(start_end(accented), (14, 16));

    let quoted_location = files.location(quoted.span).expect("inside the file");

    // The emoji is two UTF-16 units, so the closing quote is column 8 and the end column 9.
    assert_eq!((quoted_location.column, quoted_location.end_column), (4, 9));

    let accented_location = files.location(accented.span).expect("inside the file");

    assert_eq!((accented_location.line, accented_location.column), (2, 4));
    assert_eq!(accented_location.end_column, 5);
}

#[test]
fn a_non_ascii_and_an_astral_key_keep_their_text_and_order() {
    let YamlKind::Mapping(pairs) = root_of("\u{e9}t\u{e9}: 1\n\"\u{1F600}\": 2\nz: 3\n").kind
    else {
        panic!("a mapping");
    };
    let keys: Vec<&str> = pairs
        .iter()
        .filter_map(|pair| pair.key.scalar_text())
        .collect();

    assert_eq!(keys, ["\u{e9}t\u{e9}", "\u{1F600}", "z"]);
}

#[test]
fn a_key_with_an_escape_keeps_the_control_character() {
    let YamlKind::Mapping(pairs) = root_of("\"\\e[2J\": 1\n").kind else {
        panic!("a mapping");
    };

    assert_eq!(pairs[0].key.scalar_text(), Some("\u{1b}[2J"));
}

#[test]
fn a_tag_is_shown_with_the_core_prefix_as_two_bangs() {
    let YamlKind::Mapping(pairs) = root_of("a: !!str 2\nb: !custom 3\nc: 4\n").kind else {
        panic!("a mapping");
    };
    let shown: Vec<Option<String>> = pairs
        .iter()
        .filter_map(|pair| pair.value.as_ref())
        .map(YamlNode::shown_tag)
        .collect();

    assert_eq!(
        shown,
        [Some("!!str".to_owned()), Some("!custom".to_owned()), None]
    );
}

#[test]
fn a_scalar_reads_as_the_core_schema_says() {
    let YamlKind::Mapping(pairs) =
        root_of("a: 12\nb: '12'\nc: |\n  12\nd: !!str 12\ne: !!int 0x10\nf: !!int x\n").kind
    else {
        panic!("a mapping");
    };
    let resolved: Vec<ResolvedScalar> = pairs
        .iter()
        .filter_map(|pair| pair.value.as_ref())
        .filter_map(YamlNode::resolved_scalar)
        .collect();

    assert_eq!(resolved[0].to_js_string(), "12");
    assert!(resolved[0].is_number());
    assert_eq!(resolved[1], ResolvedScalar::String("12".to_owned()));
    assert_eq!(resolved[2], ResolvedScalar::String("12\n".to_owned()));
    assert_eq!(resolved[3], ResolvedScalar::String("12".to_owned()));
    assert_eq!(resolved[4].to_js_string(), "16");
    assert_eq!(resolved[5], ResolvedScalar::String("x".to_owned()));
}

#[test]
fn a_collection_and_an_alias_have_no_scalar_reading() {
    let root = root_of("a: &x [1]\nb: *x\n");
    let YamlKind::Mapping(pairs) = root.kind else {
        panic!("a mapping");
    };

    assert!(root.tag.is_none());
    assert_eq!(
        pairs[0].value.as_ref().and_then(YamlNode::resolved_scalar),
        None
    );
    assert_eq!(
        pairs[1].value.as_ref().and_then(YamlNode::resolved_scalar),
        None
    );
}

#[test]
fn block_nesting_past_the_limit_is_cut_one_level_below_it() {
    let depth = crate::LOAD_MAX_DEPTH + 10;
    let text = format!("{}x\n", "- ".repeat(depth));
    let document = parse(&text);

    assert_eq!(document.problem, None);

    let mut level = 0;
    let mut node = document.root.expect("a root");

    while let YamlKind::Sequence(items) = node.kind {
        let Some(first) = items.into_iter().next() else {
            break;
        };

        level += 1;
        node = first;
    }

    // The node at depth LOAD_MAX_DEPTH + 1 exists and has no children.
    assert_eq!(level, crate::LOAD_MAX_DEPTH + 1);
}

#[test]
fn the_end_of_the_cut_collection_still_reaches_its_last_value() {
    let depth = crate::LOAD_MAX_DEPTH + 5;
    let text = format!("{}x\n", "- ".repeat(depth));
    let document = parse(&text);
    let root = document.root.expect("a root");

    // Every enclosing block sequence ends where the last value does, below the cut or not.
    assert_eq!(usize::from(root.span.range.end()), text.len());
}

mod arbitrary_text {
    use proptest::prelude::*;

    use super::*;

    proptest! {
        // The parser may refuse any text, but the tree never panics or reports a position outside
        // the text, and every kept node's span stays inside it.
        #[test]
        fn any_text_parses_to_a_tree_inside_the_text_or_a_problem(text in "[ -~\\t\\n\u{e9}\u{1F600}]{0,200}") {
            let mut files = SourceFiles::new();
            let file = files.add("a.yaml", &text).expect("a small text");
            let normalised = files.get(file).expect("the file").text().to_owned();
            let document = parse_yaml(file, &normalised).expect("no position outside the text");

            if let Some(root) = &document.root {
                assert_inside(root, normalised.len());
            }
        }
    }

    fn assert_inside(node: &YamlNode, length: usize) {
        assert!(usize::from(node.span.range.end()) <= length);

        match &node.kind {
            YamlKind::Mapping(pairs) => {
                for pair in pairs {
                    assert_inside(&pair.key, length);

                    if let Some(value) = &pair.value {
                        assert_inside(value, length);
                    }
                }
            }
            YamlKind::Sequence(items) => items.iter().for_each(|item| assert_inside(item, length)),
            YamlKind::Scalar { .. } | YamlKind::Alias(_) => {}
        }
    }
}

#[test]
fn a_flow_collection_ends_at_its_closing_bracket_not_at_the_next_token() {
    let nested = root_of("a: { b: { c: 1 } }\n");
    let commented = root_of("a: {b: 1}  # c }\nz: 2\n");
    let last_inner = |root: &YamlNode| match &root.kind {
        YamlKind::Mapping(pairs) => pairs.first().and_then(|pair| pair.value.clone()),
        _ => None,
    };
    let outer = last_inner(&nested).expect("a value");
    let inner = match &outer.kind {
        YamlKind::Mapping(pairs) => pairs.first().and_then(|pair| pair.value.clone()),
        _ => None,
    }
    .expect("an inner mapping");

    assert_eq!(start_end(&inner), (8, 16));
    assert_eq!(start_end(&last_inner(&commented).expect("a value")), (3, 9));
}
