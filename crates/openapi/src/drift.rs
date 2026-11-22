//! Where a committed OpenAPI document and the freshly emitted one first differ.

/// The first line where two documents differ, with each side's text when it has that line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentDrift {
    /// The 1-based line number.
    pub line: usize,
    /// The committed line; absent when the committed document ends before it.
    pub committed: Option<String>,
    /// The emitted line; absent when the emitted document ends before it.
    pub emitted: Option<String>,
}

/// The first line where the committed and the emitted document differ, or `None` when equal.
#[must_use]
pub fn find_document_drift(committed: &str, emitted: &str) -> Option<DocumentDrift> {
    if committed == emitted {
        return None;
    }

    let committed_lines: Vec<&str> = committed.split('\n').collect();
    let emitted_lines: Vec<&str> = emitted.split('\n').collect();
    let line_count = committed_lines.len().max(emitted_lines.len());

    for index in 0..line_count {
        let committed_line = committed_lines.get(index).copied();
        let emitted_line = emitted_lines.get(index).copied();

        if committed_line == emitted_line {
            continue;
        }

        return Some(DocumentDrift {
            line: index + 1,
            committed: committed_line.map(str::to_owned),
            emitted: emitted_line.map(str::to_owned),
        });
    }

    // Equal lines with unequal bytes cannot happen once both split on LF; kept so every input
    // has an answer.
    Some(DocumentDrift {
        line: line_count,
        committed: None,
        emitted: None,
    })
}
