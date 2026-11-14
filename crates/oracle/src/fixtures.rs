//! The fixtures the oracle compares: every directory under `fixtures/` holding a `workspace.yaml`
//! or an `api.yaml`, and the exclusions of `scripts/oracle/excluded.json`.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_js::cmp_utf16;

use crate::OracleError;

/// The fixtures directory, relative to the repository root.
pub const FIXTURES_DIRECTORY: &str = "fixtures";

/// The expected outputs directory, relative to the repository root.
pub const EXPECTED_DIRECTORY: &str = "fixtures/expected";

/// The exclusions file, relative to the repository root.
const EXCLUDED_FILE: &str = "scripts/oracle/excluded.json";

/// The entry files of a fixture, the first present one wins.
const ENTRY_FILES: [&str; 2] = ["workspace.yaml", "api.yaml"];

/// A directory the fixture walk never enters.
const NODE_MODULES: &str = "node_modules";

/// The names under a fixture's expected directory that hold its own files.
pub(crate) const OWN_EXPECTED_ENTRIES: [&str; 5] = [
    "diagnostics.json",
    "ir",
    "source-map",
    "halves",
    "schema-calls",
];

/// One fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fixture {
    /// The path under `fixtures/`, `/` separated.
    pub path: String,
    /// The fixture directory.
    pub directory: Utf8PathBuf,
    /// `workspace.yaml` when the directory has one, else `api.yaml`.
    pub entry: String,
}

/// `excluded.json`: the fixtures the oracle does not compile, and those whose halves it skips,
/// each with its one-line reason.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExcludedFixtures {
    /// Fixture path to the reason it is not compiled.
    pub fixtures: IndexMap<String, String>,
    /// Fixture path to the reason its halves are not compared.
    pub halves: IndexMap<String, String>,
}

/// Reads `scripts/oracle/excluded.json`.
///
/// # Errors
///
/// When the file cannot be read, is no JSON, or a list is not an object of string reasons.
pub fn read_excluded(repository_root: &Utf8Path) -> Result<ExcludedFixtures, OracleError> {
    let path = repository_root.join(EXCLUDED_FILE);
    let text = read_text(&path)?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|source| OracleError::Json {
            path: path.clone(),
            source,
        })?;

    Ok(ExcludedFixtures {
        fixtures: excluded_reasons(&path, &parsed, "fixtures")?,
        halves: excluded_reasons(&path, &parsed, "halves")?,
    })
}

fn excluded_reasons(
    path: &Utf8Path,
    parsed: &serde_json::Value,
    list_name: &str,
) -> Result<IndexMap<String, String>, OracleError> {
    let problem = |problem: String| OracleError::Shape {
        path: path.to_owned(),
        problem,
    };

    let Some(members) = parsed.get(list_name).and_then(serde_json::Value::as_object) else {
        return Err(problem(format!("'{list_name}' is an object of reasons")));
    };

    members
        .iter()
        .map(|(fixture_path, reason)| match reason.as_str() {
            Some(reason) => Ok((fixture_path.clone(), reason.to_owned())),
            None => Err(problem(format!("'{fixture_path}' needs a reason"))),
        })
        .collect()
}

/// Every fixture under `fixtures/`, `fixtures/expected/` left out, sorted by UTF-16 code units.
///
/// # Errors
///
/// When a directory cannot be read, or a fixture is nested in another under a name its expected
/// outputs use.
pub fn discover_fixtures(repository_root: &Utf8Path) -> Result<Vec<Fixture>, OracleError> {
    let fixtures_root = repository_root.join(FIXTURES_DIRECTORY);
    let expected_root = repository_root.join(EXPECTED_DIRECTORY);
    let mut found_fixtures = Vec::new();

    walk(
        &fixtures_root,
        &fixtures_root,
        &expected_root,
        &mut found_fixtures,
    )?;
    found_fixtures.sort_by(|left, right| cmp_utf16(&left.path, &right.path));
    refuse_colliding_names(&found_fixtures)?;

    Ok(found_fixtures)
}

fn entry_of(directory: &Utf8Path) -> Option<&'static str> {
    ENTRY_FILES
        .into_iter()
        .find(|name| directory.join(name).exists())
}

fn walk(
    directory: &Utf8Path,
    fixtures_root: &Utf8Path,
    expected_root: &Utf8Path,
    found_fixtures: &mut Vec<Fixture>,
) -> Result<(), OracleError> {
    if let Some(entry) = entry_of(directory) {
        found_fixtures.push(Fixture {
            path: relative_path(directory, fixtures_root)?,
            directory: directory.to_owned(),
            entry: entry.to_owned(),
        });
    }

    for child in child_directories(directory)? {
        if child == expected_root || child.file_name() == Some(NODE_MODULES) {
            continue;
        }

        walk(&child, fixtures_root, expected_root, found_fixtures)?;
    }

    Ok(())
}

/// The `/`-separated path of `path` below `root`.
pub(crate) fn relative_path(path: &Utf8Path, root: &Utf8Path) -> Result<String, OracleError> {
    let below = path.strip_prefix(root).map_err(|_| OracleError::Shape {
        path: path.to_owned(),
        problem: format!("is not below {root}"),
    })?;

    Ok(below
        .components()
        .map(|component| component.as_str())
        .collect::<Vec<_>>()
        .join("/"))
}

/// The last component of a path read from a directory.
pub(crate) fn file_name_of(path: &Utf8Path) -> Result<&str, OracleError> {
    path.file_name().ok_or_else(|| OracleError::Shape {
        path: path.to_owned(),
        problem: "has no file name".to_owned(),
    })
}

/// The directories directly inside `directory`, in no particular order.
pub(crate) fn child_directories(directory: &Utf8Path) -> Result<Vec<Utf8PathBuf>, OracleError> {
    Ok(child_entries(directory)?
        .into_iter()
        .filter(|child| child.is_dir())
        .collect())
}

/// Every entry directly inside `directory`, in no particular order.
pub(crate) fn child_entries(directory: &Utf8Path) -> Result<Vec<Utf8PathBuf>, OracleError> {
    let read_error = |source| OracleError::Read {
        path: directory.to_owned(),
        source,
    };

    let mut children = Vec::new();

    for entry in fs::read_dir(directory).map_err(read_error)? {
        let path = entry.map_err(read_error)?.path();
        let path = Utf8PathBuf::from_path_buf(path).map_err(|path| OracleError::NonUtf8Path {
            path: path.to_string_lossy().into_owned(),
        })?;

        children.push(path);
    }

    Ok(children)
}

/// The text of a file.
pub(crate) fn read_text(path: &Utf8Path) -> Result<String, OracleError> {
    fs::read_to_string(path).map_err(|source| OracleError::Read {
        path: path.to_owned(),
        source,
    })
}

fn refuse_colliding_names(fixtures: &[Fixture]) -> Result<(), OracleError> {
    for fixture in fixtures {
        let parent = fixtures.iter().find_map(|other| {
            let below = fixture.path.strip_prefix(&format!("{}/", other.path))?;

            Some((other, below))
        });

        let Some((parent, below)) = parent else {
            continue;
        };

        let first_segment = below.split_once('/').map_or(below, |(first, _)| first);

        if OWN_EXPECTED_ENTRIES.contains(&first_segment) {
            return Err(OracleError::CollidingFixture {
                fixture: fixture.path.clone(),
                parent: parent.path.clone(),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(path: &str) -> Fixture {
        Fixture {
            path: path.to_owned(),
            directory: Utf8PathBuf::from(path),
            entry: "api.yaml".to_owned(),
        }
    }

    #[test]
    fn a_fixture_nested_under_an_expected_output_name_is_refused() {
        let colliding = refuse_colliding_names(&[fixture("a"), fixture("a/ir/b")]);

        assert!(matches!(
            colliding,
            Err(OracleError::CollidingFixture { fixture, parent }) if fixture == "a/ir/b" && parent == "a"
        ));
        assert!(refuse_colliding_names(&[fixture("a"), fixture("a/irs")]).is_ok());
    }
}
