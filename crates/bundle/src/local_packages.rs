//! The `package` sources the package manager resolved from a local path, which `check` refuses on
//! shared branches: a `file:`, `link:`, `workspace:` or `portal:` spec or a path in the app's
//! `package.json`, or an installed package whose real path lies outside every `node_modules`.

use std::collections::HashMap;
use std::fs;

use camino::Utf8Path;
use seampact_json::JsonValue;

use crate::BundleError;
use crate::installed_package::installed_package_directory;
use crate::untrusted_json::{UntrustedJson, parse_untrusted_json};

const PACKAGE_MANIFEST: &str = "package.json";
const DEPENDENCY_FIELDS: [&str; 3] = ["dependencies", "devDependencies", "optionalDependencies"];
const LOCAL_PROTOCOLS: [&str; 4] = ["file:", "link:", "workspace:", "portal:"];
const NODE_MODULES: &str = "node_modules";

/// Why a package is local: the spec the app's `package.json` gives, or the real path it is
/// installed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalPackageReason {
    /// The spec of the dependency.
    Spec(String),
    /// The real path of the installed package.
    RealPath(String),
}

/// A package the app installs from a local path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalPackageSource {
    /// The package name.
    pub package: String,
    /// Why it is local.
    pub reason: LocalPackageReason,
}

/// Each of `packages` that the app at `app_directory` installs from a local path, in the order
/// given.
///
/// # Errors
///
/// [`BundleError::Io`] when the app's `package.json` is unreadable or not JSON, or an installed
/// package has no real path.
pub fn find_local_package_sources(
    app_directory: &Utf8Path,
    packages: &[String],
) -> Result<Vec<LocalPackageSource>, BundleError> {
    let specs = dependency_specs(app_directory)?;
    let mut found = Vec::new();

    for name in packages {
        if let Some(spec) = specs.get(name)
            && (has_local_protocol(spec) || is_path_spec(spec))
        {
            found.push(LocalPackageSource {
                package: name.clone(),
                reason: LocalPackageReason::Spec(spec.clone()),
            });

            continue;
        }

        let Some(real_path) = installed_package_directory(name, app_directory)? else {
            continue;
        };

        if !real_path
            .as_str()
            .split(std::path::MAIN_SEPARATOR)
            .any(|part| part == NODE_MODULES)
        {
            found.push(LocalPackageSource {
                package: name.clone(),
                reason: LocalPackageReason::RealPath(real_path.into_string()),
            });
        }
    }

    Ok(found)
}

/// The first spec of each dependency name, in the order of the dependency fields.
fn dependency_specs(app_directory: &Utf8Path) -> Result<HashMap<String, String>, BundleError> {
    let file = app_directory.join(PACKAGE_MANIFEST);
    let mut specs = HashMap::new();

    if !file.exists() {
        return Ok(specs);
    }

    let bytes = fs::read(&file).map_err(|error| BundleError::Io {
        path: file.to_string(),
        message: error.to_string(),
    })?;
    let parsed = match parse_untrusted_json(&String::from_utf8_lossy(&bytes)) {
        UntrustedJson::Parsed(parsed) => parsed,
        UntrustedJson::Refused { problem } => {
            return Err(BundleError::Io {
                path: file.to_string(),
                message: format!(
                    "bundle: the app's {file} {problem}; fix it so its dependencies can be read."
                ),
            });
        }
    };
    let JsonValue::Object(manifest) = parsed else {
        return Ok(specs);
    };

    for field in DEPENDENCY_FIELDS {
        let Some(JsonValue::Object(dependencies)) = manifest.get(field) else {
            continue;
        };

        for (name, spec) in dependencies {
            if let JsonValue::String(spec) = spec {
                specs.entry(name.clone()).or_insert_with(|| spec.clone());
            }
        }
    }

    Ok(specs)
}

fn has_local_protocol(spec: &str) -> bool {
    LOCAL_PROTOCOLS
        .iter()
        .any(|protocol| spec.starts_with(protocol))
}

fn is_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// The pattern `^(?:\.{1,2}(?:[\\/]|$)|[\\/]|~[\\/]|[A-Za-z]:[\\/])`.
fn is_path_spec(spec: &str) -> bool {
    let after_dots = [".", ".."]
        .iter()
        .filter_map(|dots| spec.strip_prefix(dots))
        .any(|rest| rest.is_empty() || rest.starts_with(is_separator));

    if after_dots || spec.starts_with(is_separator) {
        return true;
    }

    if let Some(rest) = spec.strip_prefix('~') {
        return rest.starts_with(is_separator);
    }

    let mut characters = spec.chars();

    matches!(
        (characters.next(), characters.next(), characters.next()),
        (Some(drive), Some(':'), Some(separator))
            if drive.is_ascii_alphabetic() && is_separator(separator)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_specs_follow_the_pattern_edges() {
        let cases = [
            (".", true),
            ("..", true),
            ("./a", true),
            ("..\\a", true),
            ("...", false),
            (".a", false),
            ("..a", false),
            ("/abs", true),
            ("\\share", true),
            ("~/home", true),
            ("~user", false),
            ("C:\\dir", true),
            ("c:/dir", true),
            ("C:dir", false),
            ("1:/dir", false),
            ("^1.2.3", false),
            ("", false),
        ];

        for (spec, expected) in cases {
            assert_eq!(is_path_spec(spec), expected, "spec {spec:?}");
        }
    }

    #[test]
    fn protocols_are_local_only_as_a_prefix() {
        assert!(has_local_protocol("workspace:*"));
        assert!(has_local_protocol("file:../a"));
        assert!(!has_local_protocol("npm:file:a"));
        assert!(!has_local_protocol("File:a"));
    }
}
