//! The canonical file list the bundle integrity hashes.

use std::cmp::Ordering;
use std::fmt::Write as _;

use seampact_js::cmp_utf16;

use crate::BundleFile;

/// Compares two bundle paths by UTF-16 code units, as the TypeScript's `<` does.
#[must_use]
pub fn compare_bundle_paths(left: &str, right: &str) -> Ordering {
    cmp_utf16(left, right)
}

/// One line per file, `<sha256>  <path>\n`, sorted by path; the files may come in any order.
#[must_use]
pub fn canonical_bundle_file_list(files: &[BundleFile]) -> String {
    let mut sorted: Vec<&BundleFile> = files.iter().collect();

    sorted.sort_by(|left, right| compare_bundle_paths(&left.path, &right.path));

    sorted.iter().fold(String::new(), |mut list, file| {
        let _ = writeln!(list, "{}  {}", file.sha256, file.path);

        list
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_astral_character_sorts_before_a_private_use_one() {
        assert_eq!(
            compare_bundle_paths("a\u{1F600}", "a\u{E000}"),
            Ordering::Less,
            "surrogate units 0xD83D sort before 0xE000"
        );
        assert_eq!(compare_bundle_paths("a", "a"), Ordering::Equal);
    }
}
