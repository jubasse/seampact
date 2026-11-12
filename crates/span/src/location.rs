/// A range of a file in 1-based lines and 1-based UTF-16 columns: one record of the
/// source map's `locations` table.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Location {
    /// The workspace-relative path of the file.
    pub file: String,
    /// The line of the start.
    pub line: u32,
    /// The UTF-16 column of the start.
    pub column: u32,
    /// The line of the end.
    pub end_line: u32,
    /// The UTF-16 column of the end.
    pub end_column: u32,
}
