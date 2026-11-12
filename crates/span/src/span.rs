use text_size::{TextRange, TextSize};

/// The index of a file in [`SourceFiles`](crate::SourceFiles), given in load order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FileId(u32);

impl FileId {
    pub(crate) const fn from_index(index: u32) -> Self {
        Self(index)
    }

    /// The position of the file in load order.
    #[must_use]
    pub const fn index(self) -> u32 {
        self.0
    }
}

/// A byte range of one file's normalised text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    /// The file the range belongs to.
    pub file: FileId,
    /// The byte range in the file's normalised text; build it with [`Span::new`], which keeps
    /// `end` from falling before `start` as the loader's `siteOf` does.
    pub range: TextRange,
}

impl Span {
    /// The span from `start` to `end`; an `end` before `start` is read as `start`, as the
    /// loader's `siteOf` does with a node whose range ends before it starts.
    #[must_use]
    pub fn new(file: FileId, start: TextSize, end: TextSize) -> Self {
        let range = TextRange::new(start, end.max(start));

        Self { file, range }
    }
}
