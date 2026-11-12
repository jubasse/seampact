//! The loader reads files only through [`LoadReader`] (ADR 0010, the standalone binary), so a
//! runtime without a file system swaps one implementation, nothing else.
//!
//! Every path is root-relative with forward slashes; `..` segments appear only when a pack is
//! resolved from a package above the workspace root.

use std::fs;
use std::io::Read;
use std::path::PathBuf;

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};
use indexmap::{IndexMap, IndexSet};
use seampact_js::cmp_utf16;

use crate::ROOT_BOUNDARY;
use crate::paths::normalized_segments;

/// A file's text, or [`LoadText::TooLarge`] when it holds more than the bytes asked for (it is not
/// read).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadText {
    /// The decoded text.
    Text(String),
    /// The file is larger than the cap.
    TooLarge,
}

/// What the loader needs of a file system.
pub trait LoadReader {
    /// The file's text, or `None` when it does not exist or is not a file.
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText>;

    /// The names in a directory, or `None` when it does not exist.
    fn list_dir(&self, dir: &str) -> Option<Vec<String>>;

    /// The root-relative path after following symlinks, or `None` when it does not exist.
    ///
    /// A target the root cannot reach by a relative path (another drive, a UNC share) is returned
    /// absolute, and the loader treats an absolute path as outside every boundary.
    fn real_path(&self, file: &str) -> Option<String>;

    /// How many `..` steps above the root the reader can address (bounds the `node_modules`
    /// walk).
    fn ascent(&self) -> u32;
}

/// The three bytes of a UTF-8 byte order mark.
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// A path with `/` as its separator, whatever the platform's own is.
fn to_posix(path: &str) -> String {
    if std::path::MAIN_SEPARATOR == '/' {
        return path.to_owned();
    }

    path.replace(std::path::MAIN_SEPARATOR, "/")
}

/// The number of leading components that anchor a path: a Windows prefix, a root directory.
fn anchor_length(components: &[Utf8Component<'_>]) -> usize {
    components
        .iter()
        .take_while(|component| {
            matches!(component, Utf8Component::Prefix(_) | Utf8Component::RootDir)
        })
        .count()
}

/// `real` relative to `real_root`, with forward slashes.
///
/// On Windows another drive or a UNC share has no relative path; it stays absolute (`D:/x`,
/// `//host/share/x`) so that [`is_inside`](crate::is_inside) refuses it.
#[must_use]
pub fn load_root_relative(real_root: &Utf8Path, real: &Utf8Path) -> String {
    let root_parts: Vec<Utf8Component<'_>> = real_root.components().collect();
    let real_parts: Vec<Utf8Component<'_>> = real.components().collect();

    let common = root_parts
        .iter()
        .zip(&real_parts)
        .take_while(|(root_part, real_part)| root_part == real_part)
        .count();
    let anchors = anchor_length(&root_parts).max(anchor_length(&real_parts));

    if common < anchors {
        return to_posix(real.as_str());
    }

    let climbs = root_parts.len().saturating_sub(common);
    let mut segments: Vec<&str> = vec![".."; climbs];

    segments.extend(
        real_parts
            .get(common..)
            .unwrap_or(&[])
            .iter()
            .map(Utf8Component::as_str),
    );

    if segments.is_empty() {
        return ROOT_BOUNDARY.to_owned();
    }

    segments.join("/")
}

/// How many directories sit between the file system root (`/`, `C:\`, a UNC share) and `abs_root`.
#[must_use]
pub fn load_ascent_of(abs_root: &Utf8Path) -> u32 {
    let directories = abs_root
        .components()
        .filter(|component| matches!(component, Utf8Component::Normal(_)))
        .count();

    // A path holds far fewer than 2^32 directories.
    u32::try_from(directories).unwrap_or(u32::MAX)
}

/// `file` resolved against `root` as `path.resolve` does: lexically, `..` stopping at the top.
fn resolve_from(root: &Utf8Path, file: &str) -> Utf8PathBuf {
    let candidate = Utf8Path::new(file);
    let mut resolved = if candidate.is_absolute() {
        Utf8PathBuf::new()
    } else {
        root.to_owned()
    };

    for component in candidate.components() {
        match component {
            Utf8Component::Prefix(prefix) => resolved.push(prefix.as_str()),
            Utf8Component::RootDir => resolved.push(component.as_str()),
            Utf8Component::CurDir => {}
            Utf8Component::ParentDir => {
                resolved.pop();
            }
            Utf8Component::Normal(name) => resolved.push(name),
        }
    }

    resolved
}

/// Why a workspace root cannot back an [`FsReader`].
#[derive(Debug, thiserror::Error)]
pub enum FsReaderError {
    /// The root does not exist or cannot be resolved.
    #[error("cannot resolve the workspace root '{root}': {source}")]
    Root {
        /// The root as given.
        root: String,
        /// What the file system answered.
        source: std::io::Error,
    },
    /// The root's real path is not UTF-8; the loader's paths are.
    #[error("the workspace root '{}' is not valid UTF-8", .root.display())]
    NotUtf8 {
        /// The real path of the root.
        root: PathBuf,
    },
}

/// A reader over the disk below a workspace root.
///
/// Paths resolve against the root's real path, as Node's own module resolution does, so a lexical
/// path, a checked real path and a `node_modules` walk above the root agree.
#[derive(Debug, Clone)]
pub struct FsReader {
    real_root: Utf8PathBuf,
    ascent: u32,
}

impl FsReader {
    /// A reader rooted at `root`, resolved to its real path.
    ///
    /// # Errors
    ///
    /// [`FsReaderError`] when the root cannot be resolved or is not UTF-8.
    pub fn new(root: &Utf8Path) -> Result<Self, FsReaderError> {
        let real = fs::canonicalize(root).map_err(|source| FsReaderError::Root {
            root: root.to_string(),
            source,
        })?;
        let real_root =
            Utf8PathBuf::from_path_buf(real).map_err(|root| FsReaderError::NotUtf8 { root })?;

        Ok(Self {
            ascent: load_ascent_of(&real_root),
            real_root,
        })
    }

    fn absolute(&self, file: &str) -> Utf8PathBuf {
        resolve_from(&self.real_root, file)
    }
}

impl LoadReader for FsReader {
    fn ascent(&self) -> u32 {
        self.ascent
    }

    // Every failure of the file system reads as a missing file, as the TypeScript `catch` did.
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        let target = self.absolute(file);

        // stat first: opening a FIFO would block.
        if !fs::metadata(&target).ok()?.is_file() {
            return None;
        }

        let handle = fs::File::open(&target).ok()?;
        let metadata = handle.metadata().ok()?;

        if !metadata.is_file() {
            return None;
        }

        if metadata.len() > max_bytes {
            return Some(LoadText::TooLarge);
        }

        // Read to the end, never more than the cap: the file may have grown since the stat.
        let mut bytes: Vec<u8> = Vec::new();

        handle
            .take(max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .ok()?;

        if u64::try_from(bytes.len()).ok()? > max_bytes {
            return Some(LoadText::TooLarge);
        }

        // `new TextDecoder("utf-8")` strips one BOM and writes U+FFFD per invalid sequence.
        let without_bom = bytes.strip_prefix(&UTF8_BOM).unwrap_or(&bytes);

        Some(LoadText::Text(
            String::from_utf8_lossy(without_bom).into_owned(),
        ))
    }

    // Sorted, so the order does not depend on the platform's directory order.
    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        let mut names: Vec<String> = Vec::new();

        for entry in fs::read_dir(self.absolute(dir)).ok()? {
            names.push(entry.ok()?.file_name().to_string_lossy().into_owned());
        }

        names.sort_by(|left, right| cmp_utf16(left, right));

        Some(names)
    }

    // A real path that is not UTF-8 reads as missing: the loader's paths are UTF-8.
    fn real_path(&self, file: &str) -> Option<String> {
        let real = fs::canonicalize(self.absolute(file)).ok()?;
        let real = Utf8PathBuf::from_path_buf(real).ok()?;

        Some(load_root_relative(&self.real_root, &real))
    }
}

/// The ascent a [`MemoryReader`] reports unless told another.
const DEFAULT_MEMORY_ASCENT: u32 = 3;

/// Symlink hops followed before a path is taken as it stands.
const MAX_LINK_HOPS: usize = 16;

fn normalize_key(path: &str) -> String {
    normalized_segments(path).join("/")
}

/// A reader over an in-memory map of root-relative path to text, for tests.
#[derive(Debug, Clone)]
pub struct MemoryReader {
    table: IndexMap<String, String>,
    links: Vec<(String, String)>,
    ascent: u32,
}

impl MemoryReader {
    /// A reader over `files`, root-relative path and text.
    pub fn new(files: impl IntoIterator<Item = (String, String)>) -> Self {
        Self {
            table: files
                .into_iter()
                .map(|(path, text)| (normalize_key(&path), text))
                .collect(),
            links: Vec::new(),
            ascent: DEFAULT_MEMORY_ASCENT,
        }
    }

    /// Adds symlinks, link path to target path, both root-relative.
    #[must_use]
    pub fn with_links(mut self, links: impl IntoIterator<Item = (String, String)>) -> Self {
        self.links = links
            .into_iter()
            .map(|(from, to)| (normalize_key(&from), normalize_key(&to)))
            .collect();

        self
    }

    /// Sets how many `..` steps above the root the reader reports.
    #[must_use]
    pub fn with_ascent(mut self, ascent: u32) -> Self {
        self.ascent = ascent;

        self
    }

    fn resolve(&self, file: &str) -> String {
        let mut current = normalize_key(file);

        for _ in 0..MAX_LINK_HOPS {
            let Some((to, rest)) = self.links.iter().find_map(|(from, to)| {
                let rest = current.strip_prefix(from.as_str())?;

                (rest.is_empty() || rest.starts_with('/')).then_some((to, rest))
            }) else {
                return current;
            };

            current = normalize_key(&format!("{to}{rest}"));
        }

        current
    }
}

impl LoadReader for MemoryReader {
    fn ascent(&self) -> u32 {
        self.ascent
    }

    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        let text = self.table.get(&self.resolve(file))?;

        if u64::try_from(text.len()).ok()? > max_bytes {
            return Some(LoadText::TooLarge);
        }

        Some(LoadText::Text(text.clone()))
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        let base = self.resolve(dir);
        let prefix = if base.is_empty() {
            String::new()
        } else {
            format!("{base}/")
        };
        let mut names: IndexSet<String> = IndexSet::new();

        for key in self.table.keys() {
            if let Some(first) = first_segment_below(key, &prefix) {
                names.insert(first.to_owned());
            }
        }

        for (from, _) in &self.links {
            if *from != base
                && let Some(first) = first_segment_below(from, &prefix)
            {
                names.insert(first.to_owned());
            }
        }

        if names.is_empty() {
            return None;
        }

        Some(names.into_iter().collect())
    }

    fn real_path(&self, file: &str) -> Option<String> {
        let real = self.resolve(file);
        let below = format!("{real}/");
        let exists = real.is_empty()
            || self.table.contains_key(&real)
            || self.table.keys().any(|key| key.starts_with(&below));

        if !exists {
            return None;
        }

        if real.is_empty() {
            return Some(ROOT_BOUNDARY.to_owned());
        }

        Some(real)
    }
}

/// The first segment of `key` below `prefix`, when `key` starts with it.
fn first_segment_below<'key>(key: &'key str, prefix: &str) -> Option<&'key str> {
    key.strip_prefix(prefix)?.split('/').next()
}
