//! How a generated relative import names its module.

use serde::{Deserialize, Serialize};

use crate::{ExportRef, Link, LinkLocation};

/// `js` with the suffix every resolution reads, or `extensionless` for a bundler that does not map
/// a `.js` specifier to its `.ts` source.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportSpecifierStyle {
    /// `./module.js`; the default.
    #[default]
    Js,
    /// `./module`.
    Extensionless,
}

impl ImportSpecifierStyle {
    /// The style as the metadata and the app config write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Js => "js",
            Self::Extensionless => "extensionless",
        }
    }

    const fn module_suffix(self) -> &'static str {
        match self {
            Self::Js => ".js",
            Self::Extensionless => "",
        }
    }
}

/// The specifier a file at `from_file` (relative to the consumer's output root) imports
/// `export_ref` with: a relative path in `style`, or the link's module specifier and the module
/// path, whose package exports resolve a `.js` suffix whatever the style.
#[must_use]
pub fn import_specifier(
    link: &Link,
    export_ref: &ExportRef,
    from_file: &str,
    style: ImportSpecifierStyle,
) -> String {
    match &link.location {
        LinkLocation::Module { specifier } => format!(
            "{specifier}/{}{}",
            export_ref.module,
            ImportSpecifierStyle::Js.module_suffix()
        ),
        LinkLocation::Relative { path } => relative_module_specifier(
            from_file,
            &posix_join(&[path, &export_ref.module]),
            style,
        ),
    }
}

/// The POSIX relative specifier a file at `from_file` imports the module `to_module` with, both
/// relative to one root.
#[must_use]
pub fn relative_module_specifier(
    from_file: &str,
    to_module: &str,
    style: ImportSpecifierStyle,
) -> String {
    let relative_module = posix_relative(&posix_dirname(from_file), to_module);
    let dotted = if relative_module.starts_with("../") {
        relative_module
    } else {
        format!("./{relative_module}")
    };

    format!("{dotted}{}", style.module_suffix())
}

/// The segments of a relative POSIX path with `.` dropped and `..` applied, as `path.posix.normalize`;
/// a leading `..` stays.
fn normalized_segments(path: &str) -> Vec<&str> {
    let mut segments: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else {
                    segments.push("..");
                }
            }
            other => segments.push(other),
        }
    }

    segments
}

fn posix_join(parts: &[&str]) -> String {
    let joined = parts.join("/");
    let segments = normalized_segments(&joined);

    if segments.is_empty() {
        return ".".to_owned();
    }

    segments.join("/")
}

fn posix_dirname(path: &str) -> String {
    match path.rsplit_once('/') {
        Some((directory, _)) if !directory.is_empty() => directory.to_owned(),
        Some(_) => "/".to_owned(),
        None => ".".to_owned(),
    }
}

/// `path.posix.relative` of two paths relative to one root.
fn posix_relative(from: &str, to: &str) -> String {
    let from_segments = normalized_segments(from);
    let to_segments = normalized_segments(to);
    let shared = from_segments
        .iter()
        .zip(&to_segments)
        .take_while(|(left, right)| left == right)
        .count();
    let ups = from_segments.len().saturating_sub(shared);
    let mut relative: Vec<&str> = vec![".."; ups];

    relative.extend(to_segments.iter().skip(shared));

    relative.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_specifier_climbs_from_the_importing_file() {
        let cases = [
            ("routes/users.ts", "validators/users", ImportSpecifierStyle::Js, "../validators/users.js"),
            ("index.ts", "validators/users", ImportSpecifierStyle::Js, "./validators/users.js"),
            ("a/b/c.ts", "a/b/d", ImportSpecifierStyle::Extensionless, "./d"),
            ("a/b/c.ts", "x", ImportSpecifierStyle::Extensionless, "../../x"),
        ];

        for (from_file, to_module, style, expected) in cases {
            assert_eq!(
                relative_module_specifier(from_file, to_module, style),
                expected,
                "from {from_file} to {to_module}"
            );
        }
    }

    #[test]
    fn a_link_location_joins_the_module_path() {
        let export_ref = ExportRef {
            module: "schemas/user".to_owned(),
            export: "User".to_owned(),
        };
        let descriptor = crate::Descriptor::Types(crate::TypesDescriptor {
            style: crate::LinkStyle::Typescript,
            schemas: indexmap::IndexMap::new(),
            operations: indexmap::IndexMap::new(),
        });
        let relative = Link {
            descriptor: descriptor.clone(),
            location: LinkLocation::Relative {
                path: "../types/".to_owned(),
            },
        };
        let module = Link {
            descriptor,
            location: LinkLocation::Module {
                specifier: "@app/types".to_owned(),
            },
        };

        assert_eq!(
            import_specifier(&relative, &export_ref, "client.ts", ImportSpecifierStyle::Extensionless),
            "../types/schemas/user"
        );
        assert_eq!(
            import_specifier(&module, &export_ref, "client.ts", ImportSpecifierStyle::Extensionless),
            "@app/types/schemas/user.js"
        );
    }
}
