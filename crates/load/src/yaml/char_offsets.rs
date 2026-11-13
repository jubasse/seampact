//! Parser markers count characters; spans hold byte offsets.

/// A character count between two checkpoints: a lookup walks at most this many characters less
/// one.
const CHARACTERS_PER_CHECKPOINT: usize = 64;

/// The byte offset of every 64th character of a text, so a marker's character index becomes a
/// byte offset without a walk from the start.
#[derive(Debug)]
pub(super) struct CharOffsets<'text> {
    text: &'text str,
    checkpoints: Vec<usize>,
}

impl<'text> CharOffsets<'text> {
    pub(super) fn new(text: &'text str) -> Self {
        let mut checkpoints = Vec::with_capacity(text.len() / CHARACTERS_PER_CHECKPOINT + 1);
        let mut characters = 0;

        for (byte_offset, _) in text.char_indices() {
            if characters % CHARACTERS_PER_CHECKPOINT == 0 {
                checkpoints.push(byte_offset);
            }

            characters += 1;
        }

        // The end of the text is a character index too: a marker at the end.
        if characters % CHARACTERS_PER_CHECKPOINT == 0 {
            checkpoints.push(text.len());
        }

        Self { text, checkpoints }
    }

    /// The byte offset of character `character_index`; the text's length for the index just past
    /// its last character, `None` beyond.
    pub(super) fn byte_offset(&self, character_index: usize) -> Option<usize> {
        let base = *self
            .checkpoints
            .get(character_index / CHARACTERS_PER_CHECKPOINT)?;
        let remaining = character_index % CHARACTERS_PER_CHECKPOINT;
        let rest = self.text.get(base..)?;

        if let Some((offset, _)) = rest.char_indices().nth(remaining) {
            return Some(base + offset);
        }

        let characters_in_rest = rest.chars().take(remaining + 1).count();

        (characters_in_rest == remaining).then_some(self.text.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_offset(text: &str) -> Vec<Option<usize>> {
        let offsets = CharOffsets::new(text);
        let characters = text.chars().count();

        (0..=characters + 1)
            .map(|index| offsets.byte_offset(index))
            .collect()
    }

    fn expected_offsets(text: &str) -> Vec<Option<usize>> {
        let mut expected: Vec<Option<usize>> = text
            .char_indices()
            .map(|(offset, _)| Some(offset))
            .collect();

        expected.push(Some(text.len()));
        expected.push(None);

        expected
    }

    #[test]
    fn an_empty_text_has_one_offset() {
        assert_eq!(every_offset(""), vec![Some(0), None]);
    }

    #[test]
    fn ascii_text_across_checkpoints() {
        for length in [1, 63, 64, 65, 127, 128, 129, 200] {
            let text = "a".repeat(length);

            assert_eq!(
                every_offset(&text),
                expected_offsets(&text),
                "{length} characters"
            );
        }
    }

    #[test]
    fn multibyte_and_astral_characters_count_once() {
        for length in [1, 63, 64, 65, 128, 130] {
            let text = "é😀x".chars().cycle().take(length).collect::<String>();

            assert_eq!(
                every_offset(&text),
                expected_offsets(&text),
                "{length} characters"
            );
        }
    }
}
