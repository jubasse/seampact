use indexmap::IndexMap;
use line_index::{LineIndex, WideEncoding};
use text_size::{TextRange, TextSize};

use crate::{FileId, Location, Span, SpanError};

const BYTE_ORDER_MARK: char = '\u{FEFF}';

/// The loader's text normalisation, which every position is computed on: one leading byte
/// order mark removed, then `\r\n` and a lone `\r` written as `\n`.
#[must_use]
pub fn normalize_text(text: &str) -> String {
    let without_byte_order_mark = text.strip_prefix(BYTE_ORDER_MARK).unwrap_or(text);

    without_byte_order_mark
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

/// One loaded file: its workspace-relative path, its normalised text and the line index of
/// that text.
#[derive(Debug, Clone)]
pub struct SourceFile {
    path: String,
    text: String,
    line_index: LineIndex,
}

/// A 1-based line and a 1-based UTF-16 column.
struct LineColumn {
    line: u32,
    column: u32,
}

impl SourceFile {
    /// The file at `path` holding `raw_text`, normalised by [`normalize_text`].
    ///
    /// # Errors
    ///
    /// [`SpanError::TextTooLong`] when the normalised text is longer than a `u32` offset
    /// addresses.
    pub fn new(path: &str, raw_text: &str) -> Result<Self, SpanError> {
        let text = normalize_text(raw_text);

        if u32::try_from(text.len()).is_err() {
            return Err(SpanError::TextTooLong {
                path: path.to_owned(),
                bytes: text.len(),
            });
        }

        let line_index = LineIndex::new(&text);

        Ok(Self {
            path: path.to_owned(),
            text,
            line_index,
        })
    }

    /// The workspace-relative path, as the diagnostics and the source map show it.
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// The normalised text the spans point into.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The location of `range`; `None` when an end of the range is past the text or inside
    /// a character.
    #[must_use]
    pub fn location(&self, range: TextRange) -> Option<Location> {
        let start = self.line_column(range.start())?;
        let end = self.line_column(range.end())?;

        Some(Location {
            file: self.path.clone(),
            line: start.line,
            column: start.column,
            end_line: end.line,
            end_column: end.column,
        })
    }

    // `LineCounter.linePos` of the `yaml` package: lines start at 0 and after each `\n`;
    // the column counts UTF-16 units from the line start.
    fn line_column(&self, offset: TextSize) -> Option<LineColumn> {
        let byte_line_column = self.line_index.try_line_col(offset)?;
        let utf16_line_column = self
            .line_index
            .to_wide(WideEncoding::Utf16, byte_line_column)?;

        Some(LineColumn {
            line: utf16_line_column.line.checked_add(1)?,
            column: utf16_line_column.col.checked_add(1)?,
        })
    }
}

/// The files of one run, in load order; a [`FileId`] is an index into it.
#[derive(Debug, Clone, Default)]
pub struct SourceFiles {
    files: Vec<SourceFile>,
}

impl SourceFiles {
    /// An empty table.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds the file at `path` holding `raw_text` and returns its id.
    ///
    /// # Errors
    ///
    /// [`SpanError::TextTooLong`] when the text is longer than a span offset addresses,
    /// [`SpanError::TooManyFiles`] when the table is full.
    pub fn add(&mut self, path: &str, raw_text: &str) -> Result<FileId, SpanError> {
        let Ok(index) = u32::try_from(self.files.len()) else {
            return Err(SpanError::TooManyFiles {
                files: self.files.len(),
            });
        };

        self.files.push(SourceFile::new(path, raw_text)?);

        Ok(FileId::from_index(index))
    }

    /// The file of `file`; `None` for an id past the table. An id is only meaningful in
    /// the table that gave it.
    #[must_use]
    pub fn get(&self, file: FileId) -> Option<&SourceFile> {
        let index = usize::try_from(file.index()).ok()?;

        self.files.get(index)
    }

    /// The number of files.
    #[must_use]
    pub fn len(&self) -> usize {
        self.files.len()
    }

    /// Whether the table holds no file.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// The loader's `siteOf`: the location of `span`, or `None` when its file is not in the
    /// table or its range leaves the text.
    #[must_use]
    pub fn location(&self, span: Span) -> Option<Location> {
        self.get(span.file)?.location(span.range)
    }

    /// The side table of spans as a table of locations, in the same key order: what the
    /// printer and the source map read.
    ///
    /// # Errors
    ///
    /// [`SpanError::SpanOutsideFile`] naming the first key whose span has no location.
    pub fn locations(
        &self,
        spans: &IndexMap<String, Span>,
    ) -> Result<IndexMap<String, Location>, SpanError> {
        spans
            .iter()
            .map(|(key, span)| match self.location(*span) {
                Some(location) => Ok((key.clone(), location)),
                None => Err(SpanError::SpanOutsideFile { key: key.clone() }),
            })
            .collect()
    }
}

const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}

    assert_send_sync::<SourceFiles>();
};

#[cfg(test)]
mod tests {
    use super::*;

    fn offset(value: u32) -> TextSize {
        TextSize::from(value)
    }

    fn start_of(text: &str, at: u32) -> (u32, u32) {
        let mut files = SourceFiles::new();
        let file = files.add("a.yaml", text).unwrap();
        let location = files
            .location(Span::new(file, offset(at), offset(at)))
            .unwrap();

        (location.line, location.column)
    }

    #[test]
    fn the_first_offset_is_line_one_column_one() {
        assert_eq!(start_of("a: 1\n", 0), (1, 1));
    }

    #[test]
    fn an_empty_file_has_one_position() {
        assert_eq!(start_of("", 0), (1, 1));

        let mut files = SourceFiles::new();
        let file = files.add("empty.yaml", "").unwrap();

        assert_eq!(files.location(Span::new(file, offset(1), offset(1))), None);
    }

    #[test]
    fn a_line_starts_after_each_newline() {
        assert_eq!(start_of("a: 1\nb: 2\n", 5), (2, 1));
        assert_eq!(start_of("a: 1\nb: 2\n", 8), (2, 4));
        assert_eq!(start_of("a: 1\nb: 2\n", 10), (3, 1));
    }

    #[test]
    fn the_last_line_without_a_newline_ends_one_past_its_length() {
        assert_eq!(start_of("a: 1\nbc", 7), (2, 3));
    }

    #[test]
    fn an_astral_character_counts_two_columns() {
        // U+1F600 is 4 bytes and 2 UTF-16 units: the byte after it is column 4.
        let text = "a\u{1F600}b";

        assert_eq!(start_of(text, 5), (1, 4));
        assert_eq!(start_of(text, 6), (1, 5));
    }

    #[test]
    fn a_bmp_character_of_several_bytes_counts_one_column() {
        assert_eq!(start_of("\u{E9}x", 2), (1, 2));
    }

    #[test]
    fn an_offset_inside_a_character_has_no_position() {
        let mut files = SourceFiles::new();
        let file = files.add("a.yaml", "a\u{1F600}b").unwrap();

        assert_eq!(files.location(Span::new(file, offset(2), offset(2))), None);
    }

    #[test]
    fn a_tab_counts_one_column() {
        assert_eq!(start_of("\tkey: 1", 1), (1, 2));
    }

    #[test]
    fn crlf_is_one_newline() {
        let file = SourceFile::new("a.yaml", "a: 1\r\nb: 2\r\n").unwrap();

        assert_eq!(file.text(), "a: 1\nb: 2\n");
        assert_eq!(start_of("a: 1\r\nb: 2\r\n", 5), (2, 1));
    }

    #[test]
    fn a_lone_carriage_return_is_a_newline() {
        assert_eq!(normalize_text("a\rb\r\n\rc"), "a\nb\n\nc");
        assert_eq!(start_of("a\rb", 2), (2, 1));
    }

    #[test]
    fn a_byte_order_mark_is_removed_once() {
        assert_eq!(normalize_text("\u{FEFF}a"), "a");
        assert_eq!(normalize_text("\u{FEFF}\u{FEFF}a"), "\u{FEFF}a");
        assert_eq!(normalize_text("a\u{FEFF}"), "a\u{FEFF}");
        assert_eq!(start_of("\u{FEFF}ab", 1), (1, 2));
    }

    #[test]
    fn an_end_before_the_start_is_the_start() {
        let mut files = SourceFiles::new();
        let file = files.add("a.yaml", "a: 1\nb: 2").unwrap();
        let location = files
            .location(Span::new(file, offset(5), offset(1)))
            .unwrap();

        assert_eq!((location.end_line, location.end_column), (2, 1));
    }

    #[test]
    fn a_location_spans_its_start_and_end() {
        let mut files = SourceFiles::new();
        let file = files.add("parts/a.yaml", "a: 1\nbb: 2\n").unwrap();
        let location = files
            .location(Span::new(file, offset(2), offset(10)))
            .unwrap();

        assert_eq!(
            location,
            Location {
                file: "parts/a.yaml".to_owned(),
                line: 1,
                column: 3,
                end_line: 2,
                end_column: 6,
            }
        );
    }

    #[test]
    fn an_offset_past_the_end_has_no_position() {
        let mut files = SourceFiles::new();
        let file = files.add("a.yaml", "ab").unwrap();

        assert_eq!(files.location(Span::new(file, offset(3), offset(3))), None);
    }

    #[test]
    fn an_id_past_the_table_has_no_file() {
        let mut other = SourceFiles::new();
        other.add("a.yaml", "").unwrap();
        let second = other.add("b.yaml", "").unwrap();
        let mut files = SourceFiles::new();
        files.add("a.yaml", "").unwrap();

        assert!(files.get(second).is_none());
    }

    #[test]
    fn locations_keep_the_key_order_and_name_a_broken_span() {
        let mut files = SourceFiles::new();
        let file = files.add("a.yaml", "a: 1\nb: 2\n").unwrap();
        let mut spans = IndexMap::new();
        spans.insert("api#/b".to_owned(), Span::new(file, offset(5), offset(9)));
        spans.insert("api#/a".to_owned(), Span::new(file, offset(0), offset(4)));

        let locations = files.locations(&spans).unwrap();
        let keys: Vec<&str> = locations.keys().map(String::as_str).collect();

        assert_eq!(keys, ["api#/b", "api#/a"]);

        spans.insert("api#/c".to_owned(), Span::new(file, offset(40), offset(40)));

        assert_eq!(
            files.locations(&spans),
            Err(SpanError::SpanOutsideFile {
                key: "api#/c".to_owned()
            })
        );
    }
}
