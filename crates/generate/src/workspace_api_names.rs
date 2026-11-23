//! The entry file of a contract directory and the api names its workspace file declares.

use std::fs;

use camino::Utf8Path;
use seampact_load::ResolvedScalar;
use seampact_load::yaml::{YamlKind, YamlNode, parse_yaml};
use seampact_span::SourceFiles;

/// The workspace file of a contract directory.
pub const WORKSPACE_ENTRY: &str = "workspace.yaml";

/// The api file a workspace with a single api may use instead of [`WORKSPACE_ENTRY`].
pub const SINGLE_API_ENTRY: &str = "api.yaml";

/// The entry file a `path` source compiles from: the workspace file, else the single api file;
/// `None` when the directory holds neither.
#[must_use]
pub fn source_entry_file(directory: &Utf8Path) -> Option<&'static str> {
    [WORKSPACE_ENTRY, SINGLE_API_ENTRY]
        .into_iter()
        .find(|entry| directory.join(entry).exists())
}

/// The api names the directory's entry file declares; `None` when it holds no entry file, the file
/// cannot be read or parsed, or it names its apis in a form this reading does not follow.
#[must_use]
pub fn workspace_api_names(directory: &Utf8Path) -> Option<Vec<String>> {
    let entry = source_entry_file(directory)?;
    // An unreadable file leaves the answer open, as the TypeScript's read that falls back to none.
    let bytes = fs::read(directory.join(entry)).ok()?;
    let root = parsed_root(&String::from_utf8_lossy(&bytes))?;

    if entry == SINGLE_API_ENTRY {
        return single_api_name(&root);
    }

    let apis = member(member(Some(&root), "workspace"), "apis")?;
    let YamlKind::Mapping(pairs) = &apis.kind else {
        return None;
    };

    Some(
        pairs
            .iter()
            .filter_map(|pair| pair.key.scalar_text().map(str::to_owned))
            .collect(),
    )
}

fn single_api_name(root: &YamlNode) -> Option<Vec<String>> {
    let name = member(member(Some(root), "api"), "name")?;

    match name.resolved_scalar()? {
        ResolvedScalar::String(text) => Some(vec![text]),
        _ => None,
    }
}

/// The root of the first document, `None` when the text does not parse as the `yaml` package's
/// `parse` reads it: a syntax error, a second document or a repeated key.
fn parsed_root(text: &str) -> Option<YamlNode> {
    let mut files = SourceFiles::new();
    let file = files.add("workspace", text).ok()?;
    let normalised = files.get(file)?.text().to_owned();
    let document = parse_yaml(file, &normalised).ok()?;

    if document.problem.is_some() {
        return None;
    }

    let root = document.root?;

    (!has_repeated_key(&root)).then_some(root)
}

fn has_repeated_key(node: &YamlNode) -> bool {
    match &node.kind {
        YamlKind::Mapping(pairs) => {
            let mut seen: Vec<Option<ResolvedScalar>> = Vec::with_capacity(pairs.len());

            for pair in pairs {
                let key = pair.key.resolved_scalar();

                if key.is_some() && seen.contains(&key) {
                    return true;
                }

                seen.push(key);

                if has_repeated_key(&pair.key) || pair.value.as_ref().is_some_and(has_repeated_key)
                {
                    return true;
                }
            }

            false
        }
        YamlKind::Sequence(items) => items.iter().any(has_repeated_key),
        YamlKind::Scalar { .. } | YamlKind::Alias(_) => false,
    }
}

/// The value of the key `name` when `node` is a mapping that has it.
fn member<'tree>(node: Option<&'tree YamlNode>, name: &str) -> Option<&'tree YamlNode> {
    let YamlKind::Mapping(pairs) = &node?.kind else {
        return None;
    };

    pairs
        .iter()
        .find(|pair| pair.key.scalar_text() == Some(name))
        .and_then(|pair| pair.value.as_ref())
}
