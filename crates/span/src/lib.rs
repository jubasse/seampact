//! Source spans of the Rust port: where a loaded value sits in its file.
//!
//! A [`Span`] is a [`FileId`] and a byte range of that file's normalised text. The file
//! table, [`SourceFiles`], owns each text and its line index, and turns a span into a
//! [`Location`] (1-based line, 1-based UTF-16 column) only where a position is shown or
//! written: the printer and the source map.

mod error;
mod location;
mod source_files;
mod span;

pub use error::SpanError;
pub use location::Location;
pub use source_files::{SourceFile, SourceFiles, normalize_text};
pub use span::{FileId, Span};
pub use text_size::{TextRange, TextSize};
