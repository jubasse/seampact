//! The expected outputs of a fixture as files keyed by their path under
//! `fixtures/expected/<fixture path>/`, and what each file is: its output, api and half.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_js::cmp_utf16;

use crate::fixtures::{
    EXPECTED_DIRECTORY, OWN_EXPECTED_ENTRIES, child_directories, child_entries, file_name_of,
    read_text,
};
use crate::{Fixture, OracleError};

/// File path to text, sorted by UTF-16 code units of the paths.
pub type ExpectedFiles = IndexMap<String, String>;

/// The file of a fixture's diagnostics.
pub const DIAGNOSTICS_FILE: &str = "diagnostics.json";

/// The extension of every expected file.
const JSON_EXTENSION: &str = ".json";

/// The output an expected file belongs to, as `applies.output` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutputKind {
    /// `ir/<api>.json`.
    Ir,
    /// `diagnostics.json`.
    Diagnostics,
    /// `source-map/<api>.json`.
    SourceMap,
    /// `halves/<api>/<NN>-<half>.json`.
    Halves,
    /// `OpenAPI` documents, not compared yet.
    Openapi,
    /// Generated files, not compared yet.
    Generated,
}

/// What one expected file is: its output and, when it has them, its api and half.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputFile {
    /// The output the file belongs to.
    pub output: OutputKind,
    /// The api of `ir/`, `source-map/` and `halves/` files.
    pub api: Option<String>,
    /// The half of a `halves/` file.
    pub half: Option<String>,
}

impl OutputFile {
    /// What the file at `name` (relative to the fixture's expected directory) is, or `None` when
    /// the name is none of the expected layouts.
    #[must_use]
    pub fn of(name: &str) -> Option<Self> {
        if name == DIAGNOSTICS_FILE {
            return Some(Self {
                output: OutputKind::Diagnostics,
                api: None,
                half: None,
            });
        }

        let segments: Vec<&str> = name.split('/').collect();

        match segments.as_slice() {
            ["ir", file] => Self::of_api_file(OutputKind::Ir, file),
            ["source-map", file] => Self::of_api_file(OutputKind::SourceMap, file),
            ["halves", api, file] => Some(Self {
                output: OutputKind::Halves,
                api: Some((*api).to_owned()),
                half: Some(half_of_file_name(file)?.to_owned()),
            }),
            _ => None,
        }
    }

    fn of_api_file(output: OutputKind, file: &str) -> Option<Self> {
        Some(Self {
            output,
            api: Some(file.strip_suffix(JSON_EXTENSION)?.to_owned()),
            half: None,
        })
    }
}

/// The `<half>` of `<NN>-<half>.json`.
fn half_of_file_name(file_name: &str) -> Option<&str> {
    let (position, half) = file_name.strip_suffix(JSON_EXTENSION)?.split_once('-')?;
    let is_position = !position.is_empty() && position.chars().all(|digit| digit.is_ascii_digit());

    is_position.then_some(half)
}

/// The expected directory of a fixture.
#[must_use]
pub fn expected_directory_of(repository_root: &Utf8Path, fixture: &Fixture) -> Utf8PathBuf {
    repository_root.join(EXPECTED_DIRECTORY).join(&fixture.path)
}

/// The expected files of a fixture on disk, empty when it has none; its own entries only, never a
/// nested fixture's tree.
///
/// # Errors
///
/// When a file or directory cannot be read.
pub fn read_expected_files(
    repository_root: &Utf8Path,
    fixture: &Fixture,
) -> Result<ExpectedFiles, OracleError> {
    let directory = expected_directory_of(repository_root, fixture);
    let mut names = Vec::new();

    for entry in OWN_EXPECTED_ENTRIES {
        files_below(&directory.join(entry), entry, &mut names)?;
    }

    names.sort_by(|left, right| cmp_utf16(left, right));

    names
        .into_iter()
        .map(|name| {
            let text = read_text(&directory.join(&name))?;

            Ok((name, text))
        })
        .collect()
}

fn files_below(
    path: &Utf8Path,
    name: &str,
    found_names: &mut Vec<String>,
) -> Result<(), OracleError> {
    // A fixture with no expected output yet has no entry on disk: that is a difference, not a failure.
    if !path.exists() {
        return Ok(());
    }

    if !path.is_dir() {
        found_names.push(name.to_owned());

        return Ok(());
    }

    for child in child_entries(path)? {
        let child_name = format!("{name}/{}", file_name_of(&child)?);

        files_below(&child, &child_name, found_names)?;
    }

    Ok(())
}

/// The paths under `fixtures/expected/` that hold a `diagnostics.json`: the fixtures that have
/// expected outputs.
///
/// # Errors
///
/// When a directory cannot be read.
pub fn expected_fixture_paths(repository_root: &Utf8Path) -> Result<Vec<String>, OracleError> {
    let mut found_paths = Vec::new();

    collect_expected_fixture_paths(
        &repository_root.join(EXPECTED_DIRECTORY),
        "",
        &mut found_paths,
    )?;
    found_paths.sort_by(|left, right| cmp_utf16(left, right));

    Ok(found_paths)
}

fn collect_expected_fixture_paths(
    directory: &Utf8Path,
    prefix: &str,
    found_paths: &mut Vec<String>,
) -> Result<(), OracleError> {
    if !prefix.is_empty() && directory.join(DIAGNOSTICS_FILE).is_file() {
        found_paths.push(prefix.to_owned());
    }

    for child in child_directories(directory)? {
        let name = file_name_of(&child)?;

        if OWN_EXPECTED_ENTRIES.contains(&name) {
            continue;
        }

        let child_prefix = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };

        collect_expected_fixture_paths(&child, &child_prefix, found_paths)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_name_gives_its_output_api_and_half() {
        assert_eq!(
            OutputFile::of("halves/bigints/03-tree.schemas.json"),
            Some(OutputFile {
                output: OutputKind::Halves,
                api: Some("bigints".to_owned()),
                half: Some("tree.schemas".to_owned()),
            })
        );
        assert_eq!(
            OutputFile::of("ir/tasks.json").and_then(|file| file.api),
            Some("tasks".to_owned())
        );
        assert_eq!(
            OutputFile::of(DIAGNOSTICS_FILE).map(|file| file.output),
            Some(OutputKind::Diagnostics)
        );
        assert_eq!(OutputFile::of("notes.txt"), None);
    }
}
