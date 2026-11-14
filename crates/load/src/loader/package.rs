//! Finding a pack in an installed package: the `node_modules` walk from the workspace root upward
//! (ADR 0008).
//!
//! The name is checked against npm's grammar (validate-npm-package-name, new names): an optional
//! `@scope/`, then lowercase URL-safe characters, no leading `.` or `_`, at most 214 characters. A
//! name outside it could fold `node_modules/<name>` out of `node_modules` (`x/../../..`). `~` and
//! `*`, which npm allows, are refused too: `progra~1` is a Windows short name for another
//! directory, and `*` a wildcard for any tool that globs the path.

use seampact_diagnostics::{InternalError, diagnostic_inert};
use seampact_js::FiniteNumber;
use seampact_json::JsonValue;
use seampact_span::Span;

use super::Loader;
use crate::ROOT_BOUNDARY;
use crate::budget::utf16_length;
use crate::expand::parse_json_document;
use crate::paths::join_path;
use crate::report::LoadRule;
use crate::source::{CheckedFile, FileKind, OnMissing, PathContext};

const PACKAGE_NAME_MAX: u64 = 214;
const NODE_MODULES: &str = "node_modules";
const PACKAGE_MANIFEST: &str = "package.json";
const PACK_ROLE: &str = "pack";

/// The nesting of a `package.json` past which it is refused instead of parsed: `JSON.parse` has no
/// limit short of the stack, and the recursive reader and drop of the parsed value need one.
const PACKAGE_MAX_NESTING: usize = 1_000;

/// A pack package the walk found.
pub(super) struct PackageFound {
    /// The pack's entry file, as `seampact.pack` of its `package.json` names it.
    pub(super) file: String,
    /// The package directory: the boundary of everything the pack reads.
    pub(super) dir: String,
    /// The `version` of its `package.json`, when it has one.
    pub(super) version: Option<JsonValue>,
}

/// Whether `name` is a package name npm's grammar accepts for a new package.
pub(super) fn is_package_name(name: &str) -> bool {
    if utf16_length(name) > PACKAGE_NAME_MAX {
        return false;
    }

    let unscoped = match name.strip_prefix('@') {
        Some(scoped) => match scoped.split_once('/') {
            Some((scope, rest)) if is_name_segment(scope) => rest,
            _ => return false,
        },
        None => name,
    };

    is_name_segment(unscoped)
}

/// `[a-z0-9-][a-z0-9-._]*`.
fn is_name_segment(segment: &str) -> bool {
    let mut characters = segment.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    is_package_start(first)
        && characters.all(|character| is_package_start(character) || matches!(character, '.' | '_'))
}

fn is_package_start(character: char) -> bool {
    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
}

/// `String(value)` of a value read from JSON, or of an absent one.
pub(super) fn js_text_of(value: Option<&JsonValue>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(JsonValue::Null) => "null".to_owned(),
        Some(JsonValue::Bool(flag)) => flag.to_string(),
        Some(JsonValue::Number(number)) => match FiniteNumber::new(number.to_f64()) {
            Some(finite) => finite.to_string(),
            None if number.to_f64() < 0.0 => "-Infinity".to_owned(),
            None => "Infinity".to_owned(),
        },
        Some(JsonValue::String(text)) => text.clone(),
        Some(JsonValue::Array(items)) => items
            .iter()
            .map(|item| match item {
                JsonValue::Null => String::new(),
                other => js_text_of(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(JsonValue::Object(_)) => "[object Object]".to_owned(),
    }
}

impl Loader<'_, '_> {
    /// Walks `node_modules` from the workspace root upward with the reader. The name is checked
    /// against npm's grammar, and each candidate directory must be exactly
    /// `<up>/node_modules/<name>`, before anything is read.
    ///
    /// Hook for p3-dist: the first-party packs embedded in the standalone binary (ADR 0002 section
    /// 2) are the fallback when no package resolves, at the `pack-not-found` report below, served
    /// through the injected reader like any other file.
    pub(super) fn resolve_package(
        &mut self,
        name: &str,
        at: Span,
    ) -> Result<Option<PackageFound>, InternalError> {
        if !is_package_name(name) {
            return self.refuse_package_name(name, at);
        }

        let mut up = String::new();

        for depth in 0..=self.reader.ascent() {
            if depth > 0 {
                up.push_str("../");
            }

            let dir = join_path(ROOT_BOUNDARY, &format!("{up}{NODE_MODULES}/{name}"));

            // Kept should the grammar loosen.
            if dir != format!("{up}{NODE_MODULES}/{name}") {
                return self.refuse_package_name(name, at);
            }

            match self.read_package(name, &dir, at)? {
                PackageStep::Found(found) => return Ok(Some(found)),
                PackageStep::Refused => return Ok(None),
                PackageStep::Continue => {}
            }
        }

        let last_segment = name.rsplit('/').next().unwrap_or(name);

        self.report(
            LoadRule::PackNotFound,
            format!("the package '{name}' named in packs is not installed at or above the workspace root"),
            &format!("install {name}, or write the pack as a path (./packs/{last_segment}.yaml)"),
            at,
        )?;

        Ok(None)
    }

    fn refuse_package_name(
        &mut self,
        name: &str,
        at: Span,
    ) -> Result<Option<PackageFound>, InternalError> {
        self.report(
            LoadRule::PackName,
            format!(
                "'{}' is neither a path (starting with ./ or ../) nor a package name",
                diagnostic_inert(name)
            ),
            "write a package name such as @seampact/pack-crud-rights, or a path such as ./packs/house.yaml",
            at,
        )?;

        Ok(None)
    }

    /// One candidate directory of the walk.
    fn read_package(
        &mut self,
        name: &str,
        dir: &str,
        at: Span,
    ) -> Result<PackageStep, InternalError> {
        let manifest_path = format!("{dir}/{PACKAGE_MANIFEST}");

        // Contained and case-checked like any file, its real path read; a missing one is no
        // error, the walk goes on upward.
        let checked = {
            let parts = self.expander.parts();

            parts.store.touch(&manifest_path);
            parts.store.check_file(
                parts.reporter,
                &manifest_path,
                dir,
                at,
                "packs",
                &manifest_path,
                OnMissing::Return,
            )?
        };

        match checked {
            CheckedFile::Missing => return Ok(PackageStep::Continue),
            CheckedFile::Reported => return Ok(PackageStep::Refused),
            CheckedFile::Real(_) => {}
        }

        let Some(text) = self.package_text(&manifest_path)? else {
            return Ok(PackageStep::Continue);
        };
        let json = match parse_json_document(&text, PACKAGE_MAX_NESTING) {
            Ok(Some(json)) => json,
            Ok(None) => {
                self.report(
                    LoadRule::PackPackage,
                    format!("'{manifest_path}' nests deeper than {PACKAGE_MAX_NESTING} levels"),
                    "flatten the package.json",
                    at,
                )?;

                return Ok(PackageStep::Refused);
            }
            Err(_) => {
                self.report(
                    LoadRule::PackPackage,
                    format!("'{manifest_path}' is not valid JSON"),
                    "fix the package.json",
                    at,
                )?;

                return Ok(PackageStep::Refused);
            }
        };
        let seampact = json.get("seampact");
        let entry = seampact
            .filter(|seampact| {
                seampact.get("role").and_then(serde_json::Value::as_str) == Some(PACK_ROLE)
            })
            .and_then(|seampact| seampact.get("pack"))
            .and_then(serde_json::Value::as_str);

        let Some(entry) = entry else {
            self.report(
                LoadRule::PackPackage,
                format!("the package '{name}' is not a pack: its package.json needs seampact.role: pack and seampact.pack naming the entry file"),
                "install a convention pack, or reference a pack file by path",
                at,
            )?;

            return Ok(PackageStep::Refused);
        };
        let Ok(version) = json
            .get("version")
            .cloned()
            .map(JsonValue::try_from)
            .transpose()
        else {
            self.report(
                LoadRule::PackPackage,
                format!(
                    "the 'version' of '{manifest_path}' is a number beyond what a contract can hold"
                ),
                "write the version as a string such as \"1.0.0\"",
                at,
            )?;

            return Ok(PackageStep::Refused);
        };
        let from = PathContext {
            path: &manifest_path,
            boundary: dir,
        };
        let parts = self.expander.parts();
        let resolved = parts
            .store
            .resolve(parts.reporter, from, entry, at, FileKind::Manifest)?;

        Ok(match resolved {
            Some(resolved) => PackageStep::Found(PackageFound {
                file: resolved.path,
                dir: dir.to_owned(),
                version,
            }),
            None => PackageStep::Refused,
        })
    }

    /// The normalised text of a file the store read, `None` when it has none.
    fn package_text(&mut self, path: &str) -> Result<Option<String>, InternalError> {
        let parts = self.expander.parts();
        let Some(file) = parts.store.raw_text(parts.reporter, path)? else {
            return Ok(None);
        };

        Ok(parts.store.text_of(file).map(str::to_owned))
    }
}

/// What one candidate directory of the walk gave.
enum PackageStep {
    Found(PackageFound),
    /// A diagnostic was reported: the walk stops.
    Refused,
    /// No package here: the walk goes on upward.
    Continue,
}
