#![expect(
    clippy::float_cmp,
    reason = "the values are exact: the TypeScript compares them with ==="
)]

use super::*;

fn patterns() -> PitfallPatterns {
    PitfallPatterns::new().expect("the pitfall patterns compile")
}

fn number_value(source: &str) -> f64 {
    match resolve_plain_scalar(source) {
        ResolvedScalar::Number(number) => number.to_f64(),
        other => panic!("'{source}' resolved to {other:?}, not a finite number"),
    }
}

fn pitfall(source: &str) -> Option<ScalarPitfall> {
    patterns().load_scalar_pitfall(source, &resolve_plain_scalar(source))
}

#[test]
fn the_five_patterns_compile() {
    assert!(PitfallPatterns::new().is_ok());
}

#[test]
fn null_spellings() {
    for source in ["", "~", "null", "Null", "NULL"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::Null,
            "{source:?}"
        );
    }

    for source in ["nULL", "NuLL", "nil", "~~", " "] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source:?}"
        );
    }
}

#[test]
fn boolean_spellings() {
    for source in ["true", "True", "TRUE"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::Bool(true),
            "{source}"
        );
    }

    for source in ["false", "False", "FALSE"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::Bool(false),
            "{source}"
        );
    }

    for source in ["tRUE", "fALSE", "yes", "no", "on", "off", "y", "n"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source}"
        );
    }
}

#[test]
fn decimal_integers() {
    let table: [(&str, f64); 8] = [
        ("0", 0.0),
        ("+0", 0.0),
        ("12", 12.0),
        ("-12", -12.0),
        ("+12", 12.0),
        ("007", 7.0),
        ("-007", -7.0),
        ("99999999999999999999", 1e20),
    ];

    for (source, expected) in table {
        assert_eq!(number_value(source), expected, "{source}");
    }
}

#[test]
fn minus_zero_is_a_number_with_the_sign() {
    assert!(number_value("-0").is_sign_negative());
    assert_eq!(number_value("-0"), 0.0);
}

#[test]
fn an_integer_above_2_pow_53_keeps_its_digits() {
    for (source, digits) in [
        ("9007199254740993", "9007199254740993"),
        ("-9007199254740993", "-9007199254740993"),
        ("+9007199254740993", "9007199254740993"),
        ("00009007199254740993", "9007199254740993"),
    ] {
        let ResolvedScalar::Number(number) = resolve_plain_scalar(source) else {
            panic!("'{source}' is a number");
        };

        assert_eq!(number.exact_digits(), Some(digits), "{source}");
        assert_eq!(number.to_f64().abs(), 9_007_199_254_740_992.0, "{source}");
    }
}

#[test]
fn an_integer_up_to_2_pow_53_is_a_plain_number() {
    let ResolvedScalar::Number(number) = resolve_plain_scalar("9007199254740992") else {
        panic!("a number");
    };

    assert_eq!(number.exact_digits(), None);
}

#[test]
fn an_integer_with_no_finite_value_is_not_finite() {
    let overflow = format!("1{}", "0".repeat(400));

    assert_eq!(resolve_plain_scalar(&overflow), ResolvedScalar::NonFinite);
    assert_eq!(
        resolve_plain_scalar(&format!("-{overflow}")),
        ResolvedScalar::NonFinite
    );
}

#[test]
fn octal_spellings() {
    assert_eq!(number_value("0o0"), 0.0);
    assert_eq!(number_value("0o17"), 15.0);
    assert_eq!(
        number_value("0o77777777777777777777"),
        1_152_921_504_606_847_000.0
    );

    for source in ["0o8", "0o", "0O17", "-0o17", "+0o17", "0o1_7"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source}"
        );
    }
}

#[test]
fn hexadecimal_spellings() {
    assert_eq!(number_value("0x0"), 0.0);
    assert_eq!(number_value("0x1F"), 31.0);
    assert_eq!(number_value("0xff"), 255.0);
    assert_eq!(number_value(&format!("0x{}1", "0".repeat(40))), 1.0);

    for source in ["0x", "0xG", "0XFF", "-0x1F", "+0x1F"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source}"
        );
    }
}

#[test]
fn hexadecimal_and_octal_round_to_the_nearest_float_as_parse_int_does() {
    assert_eq!(number_value("0x1fffffffffffff"), 9_007_199_254_740_991.0);
    // 2^53 + 1 is a tie: it rounds to even, 2^53.
    assert_eq!(number_value("0x20000000000001"), 9_007_199_254_740_992.0);
    // 2^53 + 3 is a tie too: it rounds to even, 2^53 + 4.
    assert_eq!(number_value("0x20000000000003"), 9_007_199_254_740_996.0);
    assert_eq!(
        number_value("0xFFFFFFFFFFFFFFFFF"),
        295_147_905_179_352_830_000.0
    );
}

#[test]
fn a_digit_dropped_past_the_kept_bits_breaks_a_tie_upwards() {
    // 2^53 + 1 followed by 40 zero digits and a last one: above the tie, so it rounds up.
    let digits = format!("20000000000001{}1", "0".repeat(40));
    let value = number_value(&format!("0x{digits}"));
    let tie_value = number_value(&format!("0x20000000000001{}", "0".repeat(41)));

    assert!(value > tie_value, "{value} against {tie_value}");
}

#[test]
fn a_radix_token_past_the_float_range_is_not_finite() {
    assert_eq!(
        resolve_plain_scalar(&format!("0x{}", "f".repeat(300))),
        ResolvedScalar::NonFinite
    );
}

#[test]
fn float_spellings() {
    let table: [(&str, f64); 18] = [
        ("1.5", 1.5),
        ("-1.5", -1.5),
        ("+1.5", 1.5),
        (".5", 0.5),
        ("-.5", -0.5),
        ("+.5", 0.5),
        ("5.", 5.0),
        ("5.0", 5.0),
        ("0.", 0.0),
        ("00.5", 0.5),
        ("1e3", 1000.0),
        ("1E3", 1000.0),
        ("1e+3", 1000.0),
        ("1e-3", 0.001),
        ("1.5e3", 1500.0),
        (".5e3", 500.0),
        ("5.e3", 5000.0),
        ("0.1e-400", 0.0),
    ];

    for (source, expected) in table {
        assert_eq!(number_value(source), expected, "{source}");
    }
}

#[test]
fn near_misses_of_a_float_are_strings() {
    for source in [
        "e3", "1e", "1e+", ".", ".e3", "1_0", "1.2.3", "1:30", "0b101", "1,5", "Infinity", "NaN",
        "1e5e5",
    ] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source}"
        );
    }
}

#[test]
fn infinity_and_not_a_number_spellings_are_not_finite() {
    for source in [
        ".inf", "-.inf", "+.inf", ".Inf", "-.Inf", ".INF", "+.INF", ".nan", ".NaN", ".NAN",
        "1e999", "-1e999",
    ] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::NonFinite,
            "{source}"
        );
    }

    for source in [".iNf", "--.inf", "-.nan", "+.nan", ".nAn"] {
        assert_eq!(
            resolve_plain_scalar(source),
            ResolvedScalar::String(source.to_owned()),
            "{source}"
        );
    }
}

#[test]
fn a_number_is_a_number_for_the_pitfalls_and_null_in_a_tree() {
    assert!(resolve_plain_scalar(".nan").is_number());
    assert!(resolve_plain_scalar("12").is_number());
    assert!(!resolve_plain_scalar("true").is_number());
    assert_eq!(
        resolve_plain_scalar(".inf").into_json_value(),
        JsonValue::Null
    );
    assert_eq!(resolve_plain_scalar("~").into_json_value(), JsonValue::Null);
    assert_eq!(
        resolve_plain_scalar("true").into_json_value(),
        JsonValue::Bool(true)
    );
}

#[test]
fn js_string_of_a_resolved_scalar() {
    assert_eq!(resolve_plain_scalar("0x10").to_js_string(), "16");
    assert_eq!(resolve_plain_scalar("-0").to_js_string(), "0");
    assert_eq!(resolve_plain_scalar("1e21").to_js_string(), "1e+21");
    assert_eq!(resolve_plain_scalar("0.0000001").to_js_string(), "1e-7");
    assert_eq!(
        resolve_plain_scalar("9007199254740993").to_js_string(),
        "9007199254740992"
    );
    assert_eq!(resolve_plain_scalar("~").to_js_string(), "null");
    assert_eq!(resolve_plain_scalar("True").to_js_string(), "true");
    assert_eq!(resolve_plain_scalar(".nan").to_js_string(), "NaN");
}

#[test]
fn pitfall_table_every_listed_scalar_is_refused() {
    let p1 = [
        "y", "Y", "yes", "Yes", "YES", "n", "N", "no", "No", "NO", "on", "On", "ON", "off", "Off",
        "OFF", "True", "TRUE", "False", "FALSE",
    ];

    for source in p1 {
        assert_eq!(pitfall(source), Some(ScalarPitfall::P1), "{source}");
    }

    for source in [
        "012", "0o12", "0x1F", "+1", "1e3", ".5", "1.", ".inf", ".nan",
    ] {
        assert_eq!(pitfall(source), Some(ScalarPitfall::P2), "{source}");
    }

    for source in [
        "1_000",
        "0b101",
        "1:30",
        "2027-06-30",
        "2027-06-30T10:00:00Z",
    ] {
        assert_eq!(pitfall(source), Some(ScalarPitfall::P3), "{source}");
    }

    for source in ["=", "<<"] {
        assert_eq!(pitfall(source), Some(ScalarPitfall::P4), "{source}");
    }
}

#[test]
fn pitfall_near_misses_pass() {
    for source in [
        "true",
        "false",
        "0",
        "-1",
        "-1.5",
        "12",
        "0.5",
        "yesterday",
        "nope",
        "null",
        "tasks.update",
        "2027-06",
        "1:30pm",
        "300ms",
    ] {
        assert_eq!(pitfall(source), None, "{source}");
    }
}

#[test]
fn p2_uses_the_resolved_type_not_the_spelling() {
    let patterns = patterns();

    // Not read as a number, so P2 does not apply; the octal-looking spelling is P3 instead.
    assert_eq!(
        patterns.load_scalar_pitfall("012", &ResolvedScalar::String("012".to_owned())),
        Some(ScalarPitfall::P3)
    );
    // Read as a number, and written in plain decimal: no pitfall.
    assert_eq!(
        patterns.load_scalar_pitfall("12", &ResolvedScalar::NonFinite),
        None
    );
    assert_eq!(
        patterns.load_scalar_pitfall("012", &ResolvedScalar::NonFinite),
        Some(ScalarPitfall::P2)
    );
}

#[test]
fn p3_timestamp_matches_a_prefix_followed_by_a_separator() {
    for source in ["2027-06-30 10:00", "2027-6-3", "2027-06-30t10"] {
        assert_eq!(pitfall(source), Some(ScalarPitfall::P3), "{source}");
    }

    for source in ["2027-06-30x", "20270-06-30", "2027-006-30"] {
        assert_eq!(pitfall(source), None, "{source}");
    }
}

#[test]
fn p1_and_p4_hold_for_non_ascii_neighbours() {
    assert_eq!(pitfall("yes😀"), None);
    assert_eq!(pitfall("é"), None);
}

mod properties {
    use proptest::prelude::*;

    use super::*;

    proptest! {
        #[test]
        fn every_decimal_float_spelling_resolves_to_its_f64(
            sign in prop::sample::select(vec!["", "-", "+"]),
            whole in "[0-9]{1,6}",
            fraction in "[0-9]{1,6}",
            exponent in prop::option::of(("[eE]", prop::sample::select(vec!["", "-", "+"]), "[0-9]{1,2}")),
        ) {
            let mut source = format!("{sign}{whole}.{fraction}");

            if let Some((marker, exponent_sign, exponent_digits)) = exponent {
                source = format!("{source}{marker}{exponent_sign}{exponent_digits}");
            }

            let expected: f64 = source.parse().expect("a float spelling");

            prop_assert_eq!(number_value(&source), expected);
        }

        #[test]
        fn a_decimal_integer_resolves_to_the_value_parse_int_gives(
            sign in prop::sample::select(vec!["", "-", "+"]),
            digits in "[0-9]{1,18}",
        ) {
            let source = format!("{sign}{digits}");
            let expected: f64 = source.parse().expect("an integer spelling");

            prop_assert_eq!(number_value(&source), expected);
        }

        #[test]
        fn a_short_hexadecimal_token_is_its_exact_value(value in 0u32..u32::MAX) {
            prop_assert_eq!(number_value(&format!("0x{value:x}")), f64::from(value));
            prop_assert_eq!(number_value(&format!("0o{value:o}")), f64::from(value));
        }
    }
}
