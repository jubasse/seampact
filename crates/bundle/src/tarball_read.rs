//! The bundle tarball reader: a tarball comes from the network, so it is read whole in memory and
//! every entry checked before any byte is written.

use std::collections::{HashMap, HashSet};
use std::io::Read as _;

use camino::{Utf8Path, Utf8PathBuf};
use flate2::read::GzDecoder;
use seampact_diagnostics::quote_text;
use seampact_paths::{UnsafePathReason, untrusted_entry_problem};
use tempfile::{Builder, TempDir};

use crate::contents::BundleEntry;
use crate::limits::{BUNDLE_ARCHIVE_BYTES_MAX, BUNDLE_ENTRIES_MAX, BUNDLE_EXTRACTED_BYTES_MAX};
use crate::path::{bundle_path_fold, bundle_path_problem};
use crate::ustar::{
    CHECKSUM_FIELD, GNU_MAGIC_AND_VERSION, MAGIC_FIELD, NAME_FIELD, PAX_TYPE_EXTENDED,
    PAX_TYPE_GLOBAL, PREFIX_FIELD, SIZE_FIELD, TYPE_FIELD, USTAR_BLOCK_BYTES, USTAR_MAGIC,
    USTAR_TYPE_DIRECTORY, USTAR_TYPE_FILE, USTAR_TYPE_FILE_OLD, USTAR_VERSION, UstarField,
    VERSION_FIELD, ustar_checksum, ustar_padded,
};
use crate::{
    BUNDLE_IR_DIRECTORY, BUNDLE_MANIFEST_FILE, BUNDLE_SOURCES_DIRECTORY, BundleError,
    BundleFailure, BundleFailureCode,
};

const BUNDLE_TOP_DIRECTORIES: [&str; 2] = [BUNDLE_SOURCES_DIRECTORY, BUNDLE_IR_DIRECTORY];
const TEMPORARY_PREFIX: &str = "seampact-bundle-";
const FILE_MODE: u32 = 0o644;
/// The extraction directory is the user's alone: tempfile's default follows the umask.
const DIRECTORY_MODE: u32 = 0o700;
const FIX_DOWNLOAD: &str = "Download the bundle again, or rebuild it with `seampact bundle`.";
const FIX_TOO_LARGE: &str =
    "Check that the source names a seampact bundle; a bundle this large is not one.";

/// The magic and version fields read as one, as GNU writes them.
const GNU_MAGIC_FIELD: UstarField = UstarField {
    offset: MAGIC_FIELD.offset,
    length: MAGIC_FIELD.length + VERSION_FIELD.length,
};

/// The files of a tarball, or the failures that refuse it whole.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleArchiveRead {
    /// Every entry passed.
    Entries(Vec<BundleEntry>),
    /// Why the tarball is refused.
    Refused(Vec<BundleFailure>),
}

/// A private temporary directory holding an extracted bundle, removed when the value drops.
#[derive(Debug)]
pub struct ExtractedBundle {
    /// Removes the directory when it drops.
    _removal: TempDir,
    path: Utf8PathBuf,
}

impl ExtractedBundle {
    /// The directory the entries were written into.
    #[must_use]
    pub fn path(&self) -> &Utf8Path {
        &self.path
    }
}

/// A tarball extracted into a new directory, or the failures that refuse it whole.
#[derive(Debug)]
pub enum BundleArchiveExtraction {
    /// The entries, written into a directory removed with the guard.
    Extracted(ExtractedBundle),
    /// Why the tarball is refused.
    Refused(Vec<BundleFailure>),
}

fn invalid(reason: &str, file: Option<&str>) -> BundleFailure {
    let failure = BundleFailure::new(
        BundleFailureCode::ArchiveInvalid,
        format!("The tarball cannot be read: {reason}."),
        FIX_DOWNLOAD,
    );

    match file {
        Some(file) => failure.about(file),
        None => failure,
    }
}

/// Extracts a bundle tarball into a new private temporary directory, or refuses it whole.
///
/// # Errors
///
/// [`BundleError::Io`] when the temporary directory cannot be made or the checked entries cannot
/// be written.
pub fn extract_bundle_tarball(tarball: &[u8]) -> Result<BundleArchiveExtraction, BundleError> {
    let written = with_archive_files(tarball, write_to_temporary_directory);

    match written {
        Ok(extracted) => Ok(BundleArchiveExtraction::Extracted(extracted?)),
        Err(failures) => Ok(BundleArchiveExtraction::Refused(failures)),
    }
}

fn write_to_temporary_directory(files: &[ArchiveFile<'_>]) -> Result<ExtractedBundle, BundleError> {
    let mut builder = Builder::new();

    builder.prefix(TEMPORARY_PREFIX);
    set_directory_mode(&mut builder);

    let directory = builder.tempdir().map_err(|error| BundleError::Io {
        path: TEMPORARY_PREFIX.to_owned(),
        message: error.to_string(),
    })?;
    let path = Utf8PathBuf::from_path_buf(directory.path().to_path_buf()).map_err(|path| {
        BundleError::Io {
            path: path.display().to_string(),
            message: "the temporary directory is not UTF-8".to_owned(),
        }
    })?;

    write_entries(&path, files).map_err(|error| BundleError::Io {
        path: path.to_string(),
        message: format!("writing the checked tarball entries failed: {error}"),
    })?;

    Ok(ExtractedBundle {
        _removal: directory,
        path,
    })
}

fn write_entries(directory: &Utf8Path, entries: &[ArchiveFile<'_>]) -> std::io::Result<()> {
    for entry in entries {
        let target = directory.join(&entry.path);

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut options = std::fs::OpenOptions::new();

        options.write(true).create_new(true);
        set_file_mode(&mut options);

        std::io::Write::write_all(&mut options.open(&target)?, entry.bytes)?;
    }

    Ok(())
}

#[cfg(unix)]
fn set_directory_mode(builder: &mut Builder<'_, '_>) {
    use std::os::unix::fs::PermissionsExt as _;

    builder.permissions(std::fs::Permissions::from_mode(DIRECTORY_MODE));
}

#[cfg(not(unix))]
fn set_directory_mode(_builder: &mut Builder<'_, '_>) {}

#[cfg(unix)]
fn set_file_mode(options: &mut std::fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt as _;

    options.mode(FILE_MODE);
}

#[cfg(not(unix))]
fn set_file_mode(_options: &mut std::fs::OpenOptions) {}

/// The entries of a bundle tarball, or why it is refused.
#[must_use]
pub fn read_bundle_tarball(tarball: &[u8]) -> BundleArchiveRead {
    let read = with_archive_files(tarball, |files| {
        files
            .iter()
            .map(|file| BundleEntry {
                path: file.path.clone(),
                bytes: file.bytes.to_vec(),
            })
            .collect()
    });

    match read {
        Ok(entries) => BundleArchiveRead::Entries(entries),
        Err(failures) => BundleArchiveRead::Refused(failures),
    }
}

/// A checked file of an inflated archive, its bytes borrowed from it.
struct ArchiveFile<'archive> {
    path: String,
    bytes: &'archive [u8],
}

/// Inflates and checks `tarball`, then hands the borrowed files to `use_files`: the bytes are
/// never copied out of the inflated archive.
fn with_archive_files<T>(
    tarball: &[u8],
    use_files: impl FnOnce(&[ArchiveFile<'_>]) -> T,
) -> Result<T, Vec<BundleFailure>> {
    if tarball.len() > BUNDLE_ARCHIVE_BYTES_MAX {
        return Err(vec![
            BundleFailure::new(
                BundleFailureCode::ArchiveTooLarge,
                format!(
                    "The tarball holds {} bytes, over the cap of {BUNDLE_ARCHIVE_BYTES_MAX}.",
                    tarball.len()
                ),
                FIX_TOO_LARGE,
            )
            .expecting(BUNDLE_ARCHIVE_BYTES_MAX.to_string())
            .finding(tarball.len().to_string()),
        ]);
    }

    let archive = gunzipped(tarball).map_err(|failure| vec![*failure])?;
    let files = UstarParser::new(&archive)
        .parse()
        .map_err(|failure| vec![*failure])?;

    Ok(use_files(&files))
}

fn gunzipped(tarball: &[u8]) -> Result<Vec<u8>, Box<BundleFailure>> {
    let mut archive = Vec::new();
    let cap = u64::try_from(BUNDLE_EXTRACTED_BYTES_MAX).unwrap_or(u64::MAX);

    GzDecoder::new(tarball)
        .take(cap.saturating_add(1))
        .read_to_end(&mut archive)
        .map_err(|error| Box::new(invalid(&format!("it is not gzip data ({error})"), None)))?;

    if archive.len() > BUNDLE_EXTRACTED_BYTES_MAX {
        return Err(Box::new(BundleFailure::new(
            BundleFailureCode::ArchiveExtractedTooLarge,
            format!("The tarball holds more than {BUNDLE_EXTRACTED_BYTES_MAX} bytes once uncompressed."),
            FIX_TOO_LARGE,
        )
        .expecting(BUNDLE_EXTRACTED_BYTES_MAX.to_string())));
    }

    Ok(archive)
}

#[derive(Debug, Default)]
struct PaxOverrides {
    path: Option<String>,
    size: Option<usize>,
}

struct UstarParser<'archive> {
    archive: &'archive [u8],
    offset: usize,
    entry_count: usize,
    pax: PaxOverrides,
    files: Vec<ArchiveFile<'archive>>,
    /// Paths folded to ASCII lower case: of the files, and of every directory.
    file_by_fold: HashMap<String, String>,
    directory_folds: HashSet<String>,
}

impl<'archive> UstarParser<'archive> {
    fn new(archive: &'archive [u8]) -> Self {
        Self {
            archive,
            offset: 0,
            entry_count: 0,
            pax: PaxOverrides::default(),
            files: Vec::new(),
            file_by_fold: HashMap::new(),
            directory_folds: HashSet::new(),
        }
    }

    fn parse(mut self) -> Result<Vec<ArchiveFile<'archive>>, Box<BundleFailure>> {
        loop {
            let end = self.offset.saturating_add(USTAR_BLOCK_BYTES);
            let Some(header) = self.archive.get(self.offset..end) else {
                return Err(Box::new(invalid(
                    "it ends before its end-of-archive block",
                    None,
                )));
            };

            if header.iter().all(|byte| *byte == 0) {
                return Ok(self.files);
            }

            if let Some(failure) = self.entry(header) {
                return Err(Box::new(failure));
            }
        }
    }

    fn entry(&mut self, header: &'archive [u8]) -> Option<BundleFailure> {
        self.entry_count += 1;

        if self.entry_count > BUNDLE_ENTRIES_MAX {
            return Some(
                BundleFailure::new(
                    BundleFailureCode::ArchiveTooManyEntries,
                    format!("The tarball holds more than {BUNDLE_ENTRIES_MAX} entries."),
                    FIX_TOO_LARGE,
                )
                .expecting(BUNDLE_ENTRIES_MAX.to_string()),
            );
        }

        if let Some(problem) = header_problem(header) {
            return Some(invalid(&problem, None));
        }

        let entry_type = text(header, TYPE_FIELD, false);
        let size = self.pax.size.or_else(|| octal(header, SIZE_FIELD));
        let path = self.pax.path.clone().unwrap_or_else(|| header_path(header));

        let Some(size) = size else {
            return Some(invalid("an entry's size is not octal digits", Some(&path)));
        };

        let data_start = self.offset + USTAR_BLOCK_BYTES;
        let data_end = data_start.saturating_add(size);
        let Some(data) = self.archive.get(data_start..data_end) else {
            return Some(invalid("it ends inside an entry", Some(&path)));
        };

        self.offset = data_start.saturating_add(ustar_padded(size));

        self.typed(&entry_type, &path, data)
    }

    fn typed(
        &mut self,
        entry_type: &str,
        path: &str,
        data: &'archive [u8],
    ) -> Option<BundleFailure> {
        if entry_type == PAX_TYPE_GLOBAL {
            return None;
        }

        if entry_type == PAX_TYPE_EXTENDED {
            return match pax_overrides(data) {
                Ok(read) => {
                    self.pax = read;

                    None
                }
                Err(reason) => Some(invalid(&reason, Some(path))),
            };
        }

        self.pax = PaxOverrides::default();

        if entry_type == USTAR_TYPE_DIRECTORY {
            return self.directory(path);
        }

        if entry_type == USTAR_TYPE_FILE || entry_type == USTAR_TYPE_FILE_OLD {
            return self.file(path, data);
        }

        Some(
            BundleFailure::new(
                BundleFailureCode::ArchiveEntryType,
                format!(
                    "The tarball entry {} is of type {}; a bundle holds regular files only.",
                    quote_text(path),
                    quote_text(entry_type)
                ),
                "Rebuild the bundle with `seampact bundle`: it writes no link, device or other special entry.",
            )
            .about(path),
        )
    }

    fn directory(&mut self, path: &str) -> Option<BundleFailure> {
        let trimmed = path.strip_suffix('/').unwrap_or(path);

        if let Some(problem) = directory_path_problem(trimmed) {
            return Some(unsafe_path(path, &problem));
        }

        if self.file_by_fold.contains_key(&bundle_path_fold(trimmed)) {
            return Some(unsafe_path(path, "is both a file and a directory"));
        }

        self.add_parent_directories(trimmed);
        self.directory_folds.insert(bundle_path_fold(trimmed));

        None
    }

    fn file(&mut self, path: &str, data: &'archive [u8]) -> Option<BundleFailure> {
        if let Some(problem) = file_path_problem(path) {
            return Some(unsafe_path(path, &problem));
        }

        let folded = bundle_path_fold(path);

        if let Some(seen) = self.file_by_fold.get(&folded) {
            return Some(duplicate_entry(path, seen));
        }

        let parent_is_file = parent_paths(path)
            .iter()
            .any(|parent| self.file_by_fold.contains_key(&bundle_path_fold(parent)));

        if self.directory_folds.contains(&folded) || parent_is_file {
            return Some(unsafe_path(path, "is both a file and a directory"));
        }

        self.file_by_fold.insert(folded, path.to_owned());
        self.add_parent_directories(path);
        self.files.push(ArchiveFile {
            path: path.to_owned(),
            bytes: data,
        });

        None
    }

    fn add_parent_directories(&mut self, path: &str) {
        for parent in parent_paths(path) {
            self.directory_folds.insert(bundle_path_fold(&parent));
        }
    }
}

fn duplicate_entry(path: &str, seen: &str) -> BundleFailure {
    let message = if seen == path {
        format!("The tarball holds {} twice.", quote_text(path))
    } else {
        format!(
            "The tarball holds {} and {}, one file on a case-insensitive file system.",
            quote_text(path),
            quote_text(seen)
        )
    };

    BundleFailure::new(
        BundleFailureCode::ArchiveEntryDuplicate,
        message,
        "Rebuild the bundle with `seampact bundle`: it writes each file once.",
    )
    .about(path)
}

/// `a`, `a/b` for `a/b/c`.
fn parent_paths(path: &str) -> Vec<String> {
    let segments: Vec<&str> = path.split('/').collect();

    (1..segments.len())
        .map(|count| {
            segments
                .iter()
                .take(count)
                .copied()
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect()
}

fn unsafe_path(path: &str, problem: &str) -> BundleFailure {
    BundleFailure::new(
        BundleFailureCode::ArchiveEntryPath,
        format!(
            "The tarball entry {} {problem}; a bundle holds its manifest and portable paths under sources/ and ir/ only.",
            quote_text(path)
        ),
        "Rebuild the bundle with `seampact bundle`: its entries are the manifest and portable paths under the bundle root.",
    )
    .about(path)
}

/// The manifest, or a portable bundle path.
fn file_path_problem(path: &str) -> Option<String> {
    if path == BUNDLE_MANIFEST_FILE {
        return None;
    }

    entry_path_problem(path).or_else(|| bundle_path_problem(path))
}

/// `sources`, `ir`, or a directory a portable bundle path may hold.
fn directory_path_problem(path: &str) -> Option<String> {
    if BUNDLE_TOP_DIRECTORIES.contains(&path) {
        return None;
    }

    entry_path_problem(path).or_else(|| bundle_path_problem(path))
}

/// The unsafe paths, named before the portable rule so the refusal says what makes them unsafe.
fn entry_path_problem(path: &str) -> Option<String> {
    let reason = untrusted_entry_problem(path)?;

    Some(
        match reason {
            UnsafePathReason::Empty => "has an empty path",
            UnsafePathReason::Nul => "holds a NUL character",
            UnsafePathReason::Backslash => "holds a backslash",
            UnsafePathReason::AbsolutePrefix => "is an absolute path",
            UnsafePathReason::EmptyOrDotSegment => "has an empty, '.' or '..' segment",
        }
        .to_owned(),
    )
}

fn header_problem(header: &[u8]) -> Option<String> {
    let magic = text(header, MAGIC_FIELD, true);
    let version = text(header, VERSION_FIELD, true);
    let magic_and_version = format!("{magic}{version}");

    if magic != USTAR_MAGIC && magic_and_version != GNU_MAGIC_AND_VERSION {
        return Some("an entry is not a ustar header".to_owned());
    }

    if magic == USTAR_MAGIC && version != USTAR_VERSION {
        return Some("an entry has an unknown ustar version".to_owned());
    }

    if octal(header, CHECKSUM_FIELD).and_then(|sum| u64::try_from(sum).ok())
        != Some(ustar_checksum(header))
    {
        return Some("an entry header's checksum does not match".to_owned());
    }

    None
}

/// GNU headers hold times where ustar holds the prefix: their path is the name field only.
fn header_path(header: &[u8]) -> String {
    let name = text(header, NAME_FIELD, false);
    let prefix = if text(header, GNU_MAGIC_FIELD, true) == GNU_MAGIC_AND_VERSION {
        String::new()
    } else {
        text(header, PREFIX_FIELD, false)
    };

    if prefix.is_empty() {
        name
    } else {
        format!("{prefix}/{name}")
    }
}

/// A field's text up to its first NUL, unless `keep_nul`; a non-UTF-8 byte reads as U+FFFD.
fn text(header: &[u8], field: UstarField, keep_nul: bool) -> String {
    let bytes = header
        .get(field.offset..field.offset + field.length)
        .unwrap_or(&[]);
    let end = if keep_nul {
        bytes.len()
    } else {
        bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len())
    };

    String::from_utf8_lossy(bytes.get(..end).unwrap_or(bytes)).into_owned()
}

/// The digits as a number, saturating where JavaScript would hold a larger one.
fn saturating_number(digits: &str, radix: u32) -> Option<usize> {
    if digits.is_empty() {
        return None;
    }

    digits.chars().try_fold(0_usize, |number, digit| {
        let value = usize::try_from(digit.to_digit(radix)?).ok()?;

        Some(
            number
                .saturating_mul(usize::try_from(radix).ok()?)
                .saturating_add(value),
        )
    })
}

/// Octal digits, with the leading and trailing spaces and NULs tar writers leave; base-256 sizes
/// are refused.
fn octal(header: &[u8], field: UstarField) -> Option<usize> {
    let raw = text(header, field, true);
    let digits = raw.trim_matches(|character| character == ' ' || character == '\0');

    saturating_number(digits, 8)
}

/// A pax extended header's records, `<length> <key>=<value>\n`: `path` and `size` are read, the
/// others ignored.
fn pax_overrides(data: &[u8]) -> Result<PaxOverrides, String> {
    let mut overrides = PaxOverrides::default();
    let mut offset = 0;

    while offset < data.len() {
        let space = data
            .get(offset..)
            .and_then(|rest| rest.iter().position(|byte| *byte == 0x20))
            .map(|found| found + offset);
        let length_text = space
            .and_then(|space| data.get(offset..space))
            .map(|digits| String::from_utf8_lossy(digits).into_owned())
            .unwrap_or_default();
        let length = if length_text.chars().all(|c| c.is_ascii_digit()) {
            saturating_number(&length_text, 10)
        } else {
            None
        };

        let (Some(space), Some(length)) = (space, length) else {
            return Err(PAX_LENGTH_PROBLEM.to_owned());
        };

        if length == 0 || offset.saturating_add(length) > data.len() {
            return Err(PAX_LENGTH_PROBLEM.to_owned());
        }

        let record_end = offset + length - 1;
        let record = data
            .get(space + 1..record_end)
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
            .unwrap_or_default();

        let Some((key, value)) = record.split_once('=') else {
            return Err("a pax record is not key=value".to_owned());
        };

        if data.get(record_end) != Some(&0x0a) {
            return Err("a pax record is not key=value".to_owned());
        }

        if key == "path" {
            overrides.path = Some(value.to_owned());
        }

        if key == "size" {
            overrides.size = Some(
                saturating_number(value, 10)
                    .filter(|_| value.chars().all(|c| c.is_ascii_digit()))
                    .ok_or_else(|| "a pax size is not a decimal number".to_owned())?,
            );
        }

        offset += length;
    }

    Ok(overrides)
}

const PAX_LENGTH_PROBLEM: &str = "a pax record's length is not a number inside the header";
