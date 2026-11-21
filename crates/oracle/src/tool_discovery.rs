//! The tool cases that have a case file of their own, found below `fixtures/` as
//! `scripts/oracle/tool-cases.ts` finds them.

use camino::Utf8Path;
use seampact_js::cmp_utf16;

use crate::fixtures::{child_directories, relative_path};
use crate::{EXPECTED_DIRECTORY, FIXTURES_DIRECTORY, OracleError};

/// The kind of a case directory, read from the files it holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolCaseKind {
    /// `ir.json`: a converted OpenAPI case.
    Openapi,
    /// `merge.json`.
    Merge,
    /// `bundle.json`.
    Bundle,
    /// `cli.json`.
    Cli,
    /// `before/` and `after/`, or `before.ir.json` and `after.ir.json`.
    Diff,
}

/// One case directory and its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCasePath {
    /// The case path under `fixtures/`, `/`-separated.
    pub path: String,
    /// The case's kind.
    pub kind: ToolCaseKind,
}

const NODE_MODULES: &str = "node_modules";

/// Every case directory below `fixtures/`, sorted by UTF-16 code units of the path.
///
/// # Errors
///
/// When a directory cannot be listed or a name is no UTF-8.
pub fn discover_tool_cases(repository_root: &Utf8Path) -> Result<Vec<ToolCasePath>, OracleError> {
    let fixtures_root = repository_root.join(FIXTURES_DIRECTORY);
    let expected_root = repository_root.join(EXPECTED_DIRECTORY);
    let mut found = Vec::new();

    walk(&fixtures_root, &fixtures_root, &expected_root, &mut found)?;

    found.sort_by(|left, right| cmp_utf16(&left.path, &right.path));

    Ok(found)
}

fn walk(
    directory: &Utf8Path,
    fixtures_root: &Utf8Path,
    expected_root: &Utf8Path,
    found: &mut Vec<ToolCasePath>,
) -> Result<(), OracleError> {
    let kind = kind_of(directory);

    if let Some(kind) = kind {
        found.push(ToolCasePath {
            path: relative_path(directory, fixtures_root)?,
            kind,
        });
    }

    // A CLI case's tree is the project the command runs on, not a place for cases.
    if kind == Some(ToolCaseKind::Cli) {
        return Ok(());
    }

    for child in child_directories(directory)? {
        if child == expected_root || child.file_name() == Some(NODE_MODULES) {
            continue;
        }

        walk(&child, fixtures_root, expected_root, found)?;
    }

    Ok(())
}

fn kind_of(directory: &Utf8Path) -> Option<ToolCaseKind> {
    let holds = |name: &str| directory.join(name).exists();

    if holds("cli.json") {
        return Some(ToolCaseKind::Cli);
    }

    if holds("merge.json") {
        return Some(ToolCaseKind::Merge);
    }

    if holds("bundle.json") {
        return Some(ToolCaseKind::Bundle);
    }

    if holds("ir.json") {
        return Some(ToolCaseKind::Openapi);
    }

    let has_sides =
        (holds("before") && holds("after")) || (holds("before.ir.json") && holds("after.ir.json"));

    has_sides.then_some(ToolCaseKind::Diff)
}
