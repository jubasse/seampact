//! The entry file of a contract directory and the api names its workspace file declares.

use std::collections::HashSet;

use camino::Utf8Path;
use seampact_json::JsonNumber;
use seampact_load::yaml::{YamlKind, YamlNode, parse_yaml};
use seampact_load::{FsReader, LOAD_MAX_FILE_BYTES, LoadReader, LoadText, ResolvedScalar};
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
    // An unreadable or oversized file leaves the answer open, as the TypeScript's read that falls
    // back to none; the loader then reports the file.
    let reader = FsReader::new(directory).ok()?;
    let LoadText::Text(text) = reader.read_text(entry, LOAD_MAX_FILE_BYTES)? else {
        return None;
    };
    let root = parsed_root(&text)?;

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

/// A resolved plain key, comparable and hashable: two keys are one when the `yaml` package's
/// values are equal.
#[derive(PartialEq, Eq, Hash)]
enum KeyIdentity {
    Null,
    Bool(bool),
    Number(JsonNumber),
    NonFinite,
    String(String),
}

impl KeyIdentity {
    fn of(scalar: ResolvedScalar) -> Self {
        match scalar {
            ResolvedScalar::Null => Self::Null,
            ResolvedScalar::Bool(value) => Self::Bool(value),
            ResolvedScalar::Number(number) => Self::Number(number),
            ResolvedScalar::NonFinite => Self::NonFinite,
            ResolvedScalar::String(text) => Self::String(text),
        }
    }
}

fn has_repeated_key(node: &YamlNode) -> bool {
    match &node.kind {
        YamlKind::Mapping(pairs) => {
            let mut seen: HashSet<KeyIdentity> = HashSet::with_capacity(pairs.len());

            for pair in pairs {
                if let Some(key) = pair.key.resolved_scalar()
                    && !seen.insert(KeyIdentity::of(key))
                {
                    return true;
                }

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
