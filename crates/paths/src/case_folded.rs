//! The case-folded form of a path, for comparisons that must ignore case.

use unicode_normalization::UnicodeNormalization;

/// The path lower-cased, upper-cased, then lower-cased again, so two spellings a case-insensitive
/// file system treats as one name fold to the same text.
///
/// A plain case fold treats the capital sharp s and the dotless i differently; this order gives
/// the answer of the four writers (ADR 0015).
#[must_use]
pub fn case_folded(path: &str) -> String {
    path.to_lowercase().to_uppercase().to_lowercase()
}

/// The path NFC-normalised, then [`case_folded`]: the key two paths share on a file system that
/// ignores case and normalises Unicode.
#[must_use]
pub fn nfc_case_folded(path: &str) -> String {
    let normalised: String = path.nfc().collect();

    case_folded(&normalised)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spellings_that_differ_only_by_case_fold_alike() {
        for (left, right) in [
            ("Src/Api.ts", "src/API.TS"),
            ("Straße", "STRASSE"),
            ("ǅ", "ǆ"),
        ] {
            assert_eq!(case_folded(left), case_folded(right), "{left} and {right}");
        }
    }

    #[test]
    fn composed_and_decomposed_spellings_fold_alike_only_after_nfc() {
        let composed = "caf\u{E9}.ts";
        let decomposed = "CAFE\u{301}.ts";

        assert_ne!(case_folded(composed), case_folded(decomposed));
        assert_eq!(nfc_case_folded(composed), nfc_case_folded(decomposed));
    }
}
