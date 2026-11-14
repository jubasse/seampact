//! The known keyword closest to a misspelt one, within a small edit distance.

use seampact_js::cmp_utf16;
use std::cmp::Ordering;

const MIN_LIMIT: usize = 1;
const MAX_LIMIT: usize = 3;
const LIMIT_DIVISOR: usize = 3;

/// The known keyword closest to `word`, within a small edit distance; a tie goes to the keyword
/// that sorts first in UTF-16 order.
#[must_use]
pub fn closest_keyword<'known>(word: &str, known: &'known [String]) -> Option<&'known str> {
    let word_units: Vec<u16> = word.to_lowercase().encode_utf16().collect();
    let limit = MIN_LIMIT.max(MAX_LIMIT.min(word.encode_utf16().count() / LIMIT_DIVISOR));
    let mut best: Option<&str> = None;
    let mut best_distance = limit + 1;

    for candidate in known {
        let candidate_units: Vec<u16> = candidate.to_lowercase().encode_utf16().collect();
        let candidate_distance = distance(&word_units, &candidate_units);
        let ties_earlier = candidate_distance == best_distance
            && best.is_some_and(|current| cmp_utf16(candidate, current) == Ordering::Less);

        if candidate_distance < best_distance || ties_earlier {
            best = Some(candidate);
            best_distance = candidate_distance;
        }
    }

    if best_distance <= limit { best } else { None }
}

// Optimal string alignment distance over UTF-16 code units: insertions, deletions, substitutions,
// adjacent swaps.
fn distance(first: &[u16], second: &[u16]) -> usize {
    let columns = second.len() + 1;
    let mut cells = vec![0_usize; (first.len() + 1) * columns];

    for row in 0..=first.len() {
        set_cell(&mut cells, row * columns, row);
    }

    for column in 0..=second.len() {
        set_cell(&mut cells, column, column);
    }

    for row in 1..=first.len() {
        for column in 1..=second.len() {
            let cost = usize::from(first.get(row - 1) != second.get(column - 1));
            let mut value = (cell(&cells, (row - 1) * columns + column) + 1)
                .min(cell(&cells, row * columns + column - 1) + 1)
                .min(cell(&cells, (row - 1) * columns + column - 1) + cost);

            if row > 1
                && column > 1
                && first.get(row - 1) == second.get(column - 2)
                && first.get(row - 2) == second.get(column - 1)
            {
                value = value.min(cell(&cells, (row - 2) * columns + column - 2) + 1);
            }

            set_cell(&mut cells, row * columns + column, value);
        }
    }

    cell(&cells, first.len() * columns + second.len())
}

// Every index is within the table sized by `distance`, so the checked reads and writes below never
// miss; a miss would leave the distance wrong, never panic.
fn cell(cells: &[usize], index: usize) -> usize {
    cells.get(index).copied().unwrap_or_default()
}

fn set_cell(cells: &mut [usize], index: usize, value: usize) {
    if let Some(slot) = cells.get_mut(index) {
        *slot = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_owned()).collect()
    }

    #[test]
    fn a_misspelt_keyword_finds_its_closest_known_one() {
        let words = known(&["method", "kind", "relays"]);

        assert_eq!(closest_keyword("metod", &words), Some("method"));
        assert_eq!(closest_keyword("METHOD", &words), Some("method"));
        assert_eq!(closest_keyword("kidn", &words), Some("kind"));
    }

    #[test]
    fn a_word_too_far_from_every_keyword_has_none() {
        assert_eq!(closest_keyword("zzzzzz", &known(&["method", "kind"])), None);
        assert_eq!(closest_keyword("x", &known(&["method"])), None);
    }

    #[test]
    fn a_tie_goes_to_the_keyword_that_sorts_first() {
        let words = known(&["bb", "ba"]);

        assert_eq!(closest_keyword("bc", &words), Some("ba"));
    }

    #[test]
    fn the_limit_counts_utf16_units_and_the_distance_works_on_them() {
        // One astral character is two units: two substitutions, over the limit of one for a
        // word of 2 units.
        assert_eq!(closest_keyword("\u{1F600}", &known(&["ab"])), None);
        // Three units allow a distance of one.
        assert_eq!(closest_keyword("abc", &known(&["abd"])), Some("abd"));
    }
}
