/// A failure of the file table: a limit the loader enforces earlier, or a span the code broke.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SpanError {
    /// The text is longer than a span offset can address.
    #[error("file '{path}' holds {bytes} bytes, more than a span offset addresses")]
    TextTooLong {
        /// The workspace-relative path of the file.
        path: String,
        /// The byte length of its normalised text.
        bytes: usize,
    },

    /// The table already holds as many files as a file id can address.
    #[error("the file table already holds {files} files, the most a file id addresses")]
    TooManyFiles {
        /// The number of files in the table.
        files: usize,
    },

    /// A span of the side table names no file of the table or leaves its text.
    #[error("the span of location '{key}' is outside its file")]
    SpanOutsideFile {
        /// The side table key of the span.
        key: String,
    },
}
