//! What the expansion carries down the tree: where it is, what the schema says of it, and the
//! chain of files it came through.

use std::rc::Rc;

use indexmap::IndexMap;
use seampact_json::JsonValue;
use seampact_span::Span;

use crate::positions::Position;
use crate::source::ParsedFile;

/// One file of the `$include`/`$file` chain: `key` is the real path, `shown` the written one.
#[derive(Debug, Clone)]
pub(super) struct StackEntry {
    pub(super) key: String,
    pub(super) shown: String,
    pub(super) at: Span,
}

/// The keys one mapping received, its own and those its `$include`s merged, in order, each with
/// where it was first written.
#[derive(Debug, Default)]
pub(super) struct MapKeys(pub(super) IndexMap<String, Span>);

/// A `$file` JSON file, parsed and made safe once per real path, then charged per use.
#[derive(Debug)]
pub(super) enum JsonFile {
    /// The tree and what one use of it costs.
    Valid {
        value: JsonValue,
        nodes: u64,
        text: u64,
        depth: usize,
    },
    /// The parser's message.
    Invalid { error: String },
    /// Nested deeper than any use could admit: not parsed.
    TooDeep,
}

/// Where the expansion is in one tree.
#[derive(Debug, Clone)]
pub(super) struct Scope {
    pub(super) file: Rc<ParsedFile>,
    /// True in a data position (and below it), one the authoring schema marks `DATA`.
    pub(super) data: bool,
    /// Where the authoring schema places this node (P6); `None` when it says nothing.
    pub(super) pos: Option<Position>,
    pub(super) parent_key: Option<Rc<str>>,
    pub(super) stack: Rc<Vec<StackEntry>>,
    /// Nesting level in the merged tree, through includes and `$file`.
    pub(super) depth: usize,
}

impl Scope {
    /// The chain extended by one file.
    pub(super) fn stack_with(&self, entry: StackEntry) -> Rc<Vec<StackEntry>> {
        let mut stack = Vec::with_capacity(self.stack.len() + 1);

        stack.extend(self.stack.iter().cloned());
        stack.push(entry);

        Rc::new(stack)
    }
}
