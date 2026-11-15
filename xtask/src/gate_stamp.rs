//! The record of a gate that passed on a clean tree: `wave.sh land` skips its own gate when the
//! stamp names the commit it is about to push.

use std::fs;
use std::process::Command;

use camino::Utf8Path;

/// The stamp file, relative to the workspace root.
const GATE_STAMP_FILE: &str = "target/gate-ok";

/// Removes the stamp before a gate runs, so a failed run never leaves an earlier pass behind.
pub fn clear_gate_stamp(workspace_root: &Utf8Path) {
    let stamp = workspace_root.join(GATE_STAMP_FILE);

    if let Err(error) = fs::remove_file(&stamp)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!("gate stamp: cannot remove {stamp}: {error}");
    }
}

/// Writes the HEAD commit into the stamp after a passing gate, when the tree has no change.
pub fn write_gate_stamp(workspace_root: &Utf8Path) {
    let (Some(status), Some(head)) = (
        git_output(workspace_root, &["status", "--porcelain"]),
        git_output(workspace_root, &["rev-parse", "HEAD"]),
    ) else {
        eprintln!("gate stamp: git did not answer; wave.sh land will rerun the gate");

        return;
    };

    let Some(text) = stamp_text(&status, &head) else {
        eprintln!("gate stamp: the tree has changes; wave.sh land will rerun the gate");

        return;
    };

    let stamp = workspace_root.join(GATE_STAMP_FILE);

    if let Err(error) = fs::write(&stamp, text) {
        eprintln!("gate stamp: cannot write {stamp}: {error}; wave.sh land will rerun the gate");
    }
}

/// The stamp for a clean tree (an empty `git status --porcelain`), `None` for a tree with changes.
fn stamp_text(porcelain_status: &str, head: &str) -> Option<String> {
    porcelain_status
        .trim()
        .is_empty()
        .then(|| format!("{}\n", head.trim()))
}

fn git_output(workspace_root: &Utf8Path, arguments: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(workspace_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_tree_stamps_its_head() {
        assert_eq!(stamp_text("", "abc123\n"), Some("abc123\n".to_owned()));
    }

    #[test]
    fn a_tree_with_changes_gets_no_stamp() {
        assert_eq!(stamp_text(" M crates/x/src/lib.rs\n", "abc123\n"), None);
    }
}
