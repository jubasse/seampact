//! A reader that remembers the text of every file the load stage read.

use std::cell::RefCell;
use std::collections::HashMap;

use seampact_load::{LoadReader, LoadText};

/// Wraps a reader and keeps each text it returns, so the bundle holds the bytes the compiler saw.
pub(crate) struct RecordingReader<'reader> {
    reader: &'reader dyn LoadReader,
    texts: RefCell<HashMap<String, String>>,
}

impl<'reader> RecordingReader<'reader> {
    pub(crate) fn new(reader: &'reader dyn LoadReader) -> Self {
        Self {
            reader,
            texts: RefCell::new(HashMap::new()),
        }
    }

    /// The text read for `file`, or for the real path it resolves to.
    pub(crate) fn text_of(&self, file: &str) -> Option<String> {
        if let Some(named) = self.texts.borrow().get(file) {
            return Some(named.clone());
        }

        let real = self.reader.real_path(file)?;
        let texts = self.texts.borrow();

        texts.get(&real).cloned()
    }
}

impl LoadReader for RecordingReader<'_> {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        if let Some(first) = self.texts.borrow().get(file) {
            let fits = u64::try_from(first.len()).is_ok_and(|length| length <= max_bytes);

            if fits {
                return Some(LoadText::Text(first.clone()));
            }
        }

        let read = self.reader.read_text(file, max_bytes);

        if let Some(LoadText::Text(text)) = &read {
            self.texts
                .borrow_mut()
                .insert(file.to_owned(), text.clone());
        }

        read
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        self.reader.list_dir(dir)
    }

    fn real_path(&self, file: &str) -> Option<String> {
        self.reader.real_path(file)
    }

    fn ascent(&self) -> u32 {
        self.reader.ascent()
    }
}
