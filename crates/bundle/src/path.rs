//! The portable-path rule of a bundle file.

/// The longest bundle path, in UTF-16 code units (the schema's `$defs/path` `maxLength`).
pub const BUNDLE_PATH_MAX_LENGTH: usize = 255;

const TOP_DIRECTORIES: [&str; 2] = ["sources", "ir"];

/// The Windows device names a segment may not start with, before its first `.`.
const DEVICE_NAMES: [&str; 4] = ["con", "prn", "aux", "nul"];

/// The Windows devices named with one digit after three letters.
const NUMBERED_DEVICES: [&str; 2] = ["com", "lpt"];

fn is_portable_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '@' | '+' | '-')
}

/// `path` with `A-Z` folded to `a-z` and every other character kept.
#[must_use]
pub fn bundle_path_fold(path: &str) -> String {
    path.to_ascii_lowercase()
}

fn is_device_stem(folded_stem: &str) -> bool {
    if DEVICE_NAMES.contains(&folded_stem) {
        return true;
    }

    let Some(prefix) = folded_stem.get(..3) else {
        return false;
    };
    let digit = folded_stem.get(3..).unwrap_or("");

    NUMBERED_DEVICES.contains(&prefix)
        && digit.len() == 1
        && digit.chars().all(|c| c.is_ascii_digit())
}

fn stem_of(segment: &str) -> &str {
    segment.split('.').next().unwrap_or("")
}

fn segment_problem(segment: &str) -> Option<String> {
    if matches!(segment, "" | "." | "..") {
        return Some("has an empty, '.' or '..' segment".to_owned());
    }

    if let Some(unportable) = segment
        .chars()
        .find(|character| !is_portable_character(*character))
    {
        return Some(format!(
            "holds U+{}, outside the portable characters A-Z a-z 0-9 . _ @ + -",
            code_point_hex(unportable)
        ));
    }

    if segment.ends_with('.') {
        return Some(format!(
            "has the segment '{segment}', ending in '.' (Windows drops it)"
        ));
    }

    if is_device_stem(&bundle_path_fold(stem_of(segment))) {
        return Some(format!(
            "has the segment '{segment}', a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9)"
        ));
    }

    None
}

fn code_point_hex(character: char) -> String {
    format!("{:04X}", u32::from(character))
}

/// The schema's `$defs/path` pattern: `sources` or `ir`, then one or more segments of portable
/// characters that do not end in `.`.
fn matches_path_pattern(segments: &[&str]) -> bool {
    let Some((top, below)) = segments.split_first() else {
        return false;
    };

    TOP_DIRECTORIES.contains(top)
        && !below.is_empty()
        && below.iter().all(|segment| {
            !segment.is_empty()
                && segment.chars().all(is_portable_character)
                && !segment.ends_with('.')
        })
}

/// The schema's `$defs/path` `not` pattern: a segment below the top directory naming a device.
fn names_device(segments: &[&str]) -> bool {
    segments
        .iter()
        .skip(1)
        .any(|segment| is_device_stem(&bundle_path_fold(stem_of(segment))))
}

/// Why `path` is not a portable bundle path, or `None` when it is one.
#[must_use]
pub fn bundle_path_problem(path: &str) -> Option<String> {
    if path.encode_utf16().count() > BUNDLE_PATH_MAX_LENGTH {
        return Some(format!(
            "is longer than {BUNDLE_PATH_MAX_LENGTH} characters"
        ));
    }

    let segments: Vec<&str> = path.split('/').collect();
    let top = segments.first().copied().unwrap_or("");

    if !TOP_DIRECTORIES.contains(&top) || segments.len() < 2 {
        return Some("is not a file under sources/ or ir/".to_owned());
    }

    if let Some(problem) = segments.iter().find_map(|segment| segment_problem(segment)) {
        return Some(problem);
    }

    if !matches_path_pattern(&segments) || names_device(&segments) {
        return Some("does not match the portable path pattern".to_owned());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_longer_than_the_cap_counts_utf16_units() {
        let at_cap = format!("sources/{}", "a".repeat(BUNDLE_PATH_MAX_LENGTH - 8));
        let past_cap = format!("sources/{}", "a".repeat(BUNDLE_PATH_MAX_LENGTH - 7));
        let astral = format!("sources/{}", "\u{1F600}".repeat(125));

        assert_eq!(bundle_path_problem(&at_cap), None);
        assert_eq!(
            bundle_path_problem(&past_cap).as_deref(),
            Some("is longer than 255 characters")
        );
        assert_eq!(
            bundle_path_problem(&astral).as_deref(),
            Some("is longer than 255 characters"),
            "125 astral characters are 250 units plus 8"
        );
    }

    #[test]
    fn an_unportable_character_is_named_by_its_code_point() {
        assert_eq!(
            bundle_path_problem("sources/\u{1F600}.yaml").as_deref(),
            Some("holds U+1F600, outside the portable characters A-Z a-z 0-9 . _ @ + -")
        );
        assert_eq!(
            bundle_path_problem("sources/\u{e9}").as_deref(),
            Some("holds U+00E9, outside the portable characters A-Z a-z 0-9 . _ @ + -")
        );
    }

    #[test]
    fn a_device_name_is_refused_before_its_first_dot_in_any_case() {
        for path in [
            "sources/CON",
            "sources/nul.txt",
            "ir/Com1.json",
            "sources/a/LPT9.x",
        ] {
            assert!(
                bundle_path_problem(path).is_some_and(|problem| problem.contains("device name")),
                "path {path:?}"
            );
        }

        assert_eq!(bundle_path_problem("sources/com10.yaml"), None);
        assert_eq!(bundle_path_problem("sources/console.yaml"), None);
    }

    #[test]
    fn the_fold_changes_ascii_capitals_only() {
        assert_eq!(bundle_path_fold("Sources/\u{c9}A"), "sources/\u{c9}a");
    }

    #[test]
    fn a_top_directory_alone_or_another_one_is_refused() {
        for path in ["sources", "ir", "other/a", "sources//a", "sources/a."] {
            assert!(bundle_path_problem(path).is_some(), "path {path:?}");
        }
    }
}
