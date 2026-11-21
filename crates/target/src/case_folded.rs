//! The case-folded form of a path, for comparisons that must ignore case.

/// The path lower-cased, upper-cased, then lower-cased again, so two spellings a case-insensitive
/// file system treats as one name fold to the same text.
#[must_use]
pub fn case_folded(path: &str) -> String {
    path.to_lowercase().to_uppercase().to_lowercase()
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
}
