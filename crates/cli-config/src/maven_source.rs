//! A `maven` source must name one release: a dynamic or snapshot version cannot be pinned.

use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, object_of, text_of};

use crate::config_position::ParsedConfig;
use crate::key_path::KeyPathSegment;
use crate::{CliConfigError, CliProblem};

const SNAPSHOT_SUFFIX: &str = "-snapshot";
const LATEST_PREFIX: &str = "latest.";
const RANGE_CHARACTERS: [char; 5] = ['[', ']', '(', ')', ','];
const VERSION_FIELD_INDEX: usize = 2;

/// One `config.source.maven-unpinned` problem for each `maven` source naming a dynamic version.
pub(crate) fn unpinned_maven_problems(
    parsed: &ParsedConfig,
    sources: Option<&JsonValue>,
) -> Result<Vec<CliProblem>, CliConfigError> {
    let mut problems = Vec::new();

    for (name, source) in object_of(sources)
        .into_iter()
        .flat_map(|object| object.iter())
    {
        let Some(maven) = object_of(Some(source)).and_then(|object| object.get("maven")) else {
            continue;
        };
        let coordinate = text_of(Some(maven)).ok_or_else(|| {
            InternalError::new("a maven source that is not text passed the schema")
        })?;
        let version = coordinate.split(':').nth(VERSION_FIELD_INDEX).unwrap_or("");

        if !is_unpinned_version(version) {
            continue;
        }

        let path = [
            KeyPathSegment::key("sources"),
            KeyPathSegment::key(name),
            KeyPathSegment::key("maven"),
        ];

        problems.push(CliProblem::at(
            "config.source.maven-unpinned",
            format!(
                "The source '{name}' names the Maven version '{version}', a dynamic or snapshot version; the integrity pin needs one release."
            ),
            "Name a release version, such as 1.4.0, and pin its integrity.",
            parsed.where_of(&path)?,
        ));
    }

    Ok(problems)
}

fn is_unpinned_version(version: &str) -> bool {
    let lower = version.to_lowercase();

    lower.ends_with('+')
        || lower.starts_with(LATEST_PREFIX)
        || lower.ends_with(SNAPSHOT_SUFFIX)
        || version.contains(RANGE_CHARACTERS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_snapshot_and_range_versions_are_unpinned() {
        for version in [
            "1.+",
            "LATEST.release",
            "1.0-SNAPSHOT",
            "[1.0,2.0)",
            "1,2",
            "(1",
        ] {
            assert!(is_unpinned_version(version), "{version}");
        }

        for version in ["1.4.0", "", "1.0-snap"] {
            assert!(!is_unpinned_version(version), "{version}");
        }
    }
}
