//! The size and duration readers and their grammar patterns.

use seampact_pipeline::{UnitKind, parse_duration, parse_size, unit_pattern, unit_table};

#[test]
fn unit_readers_follow_the_grammar() {
    assert_eq!(parse_size("1MiB").unwrap(), Some(1_048_576));
    assert_eq!(parse_size("512KiB").unwrap(), Some(524_288));
    assert_eq!(parse_size("10B").unwrap(), Some(10));
    assert_eq!(parse_duration("150ms").unwrap(), Some(150));
    assert_eq!(parse_duration("24h").unwrap(), Some(86_400_000));
    assert_eq!(parse_duration("2d").unwrap(), Some(172_800_000));

    for text in [
        "1 MiB", "1GiB", "-1s", "1.5s", "s", "", "1B\n", "\n1B", "１B", "1b",
    ] {
        assert_eq!(parse_size(text).unwrap(), None, "size {text:?}");
        assert_eq!(parse_duration(text).unwrap(), None, "duration {text:?}");
    }
}

#[test]
fn a_value_beyond_a_safe_integer_is_refused() {
    assert_eq!(
        parse_size("9007199254740991B").unwrap(),
        Some(9_007_199_254_740_991)
    );
    assert_eq!(parse_size("9007199254740992B").unwrap(), None);
    assert_eq!(parse_size("9007199254740991KiB").unwrap(), None);
    assert_eq!(parse_size(&format!("{}MiB", "9".repeat(20))).unwrap(), None);
    assert_eq!(parse_size(&format!("{}B", "9".repeat(400))).unwrap(), None);
    assert_eq!(parse_size("007B").unwrap(), Some(7));
    assert_eq!(parse_duration("0ms").unwrap(), Some(0));
}

// The units a pattern `^[0-9]+(?:a|b)$` accepts.
fn pattern_units(pattern: &str) -> Vec<String> {
    let inside = pattern
        .split_once("(?:")
        .and_then(|(_, rest)| rest.split_once(')'))
        .map(|(units, _)| units)
        .unwrap();

    inside.split('|').map(str::to_owned).collect()
}

#[test]
fn each_reader_knows_every_unit_its_pattern_accepts_and_no_other() {
    for kind in [UnitKind::Size, UnitKind::Duration] {
        let mut from_pattern = pattern_units(unit_pattern(kind).unwrap());
        let mut from_table: Vec<String> = unit_table(kind)
            .iter()
            .map(|(unit, _)| (*unit).to_owned())
            .collect();

        from_pattern.sort();
        from_table.sort();

        assert_eq!(from_pattern, from_table, "{kind:?}");
    }
}
