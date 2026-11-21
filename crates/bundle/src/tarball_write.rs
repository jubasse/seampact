//! The bundle tarball: ustar, regular files only, gzip with no timestamp.

use std::io::Write as _;

use flate2::{Compression, GzBuilder};
use seampact_diagnostics::InternalError;

use crate::BundleError;
use crate::contents::{BundleContents, BundleEntry, bundle_entries};
use crate::ustar::{
    CHECKSUM_FIELD, DEVICE_MAJOR_FIELD, DEVICE_MINOR_FIELD, GID_FIELD, MAGIC_FIELD, MODE_FIELD,
    MTIME_FIELD, NAME_FIELD, PREFIX_FIELD, SIZE_FIELD, TYPE_FIELD, UID_FIELD, USTAR_BLOCK_BYTES,
    USTAR_MAGIC, USTAR_TYPE_FILE, USTAR_VERSION, UstarField, VERSION_FIELD, ustar_checksum,
    ustar_padded, ustar_path_split,
};

const FILE_MODE: u64 = 0o644;
const GZIP_OS_BYTE_OFFSET: usize = 9;
const GZIP_OS_UNKNOWN: u8 = 255;
const END_OF_ARCHIVE_BLOCKS: usize = 2;

/// The gzipped ustar bytes of a bundle: the same contents give the same bytes on every machine.
///
/// # Errors
///
/// [`BundleError::Internal`] when a path does not fit a header (the builder refuses such a path
/// first) or the compressor fails.
pub fn bundle_tarball(contents: &BundleContents) -> Result<Vec<u8>, BundleError> {
    let archive = ustar_archive(&bundle_entries(contents))?;
    let mut encoder = GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), Compression::best());

    encoder
        .write_all(&archive)
        .map_err(|error| InternalError::new(format!("bundle: gzip failed: {error}")))?;

    let mut gzipped = encoder
        .finish()
        .map_err(|error| InternalError::new(format!("bundle: gzip failed: {error}")))?;

    if let Some(os_byte) = gzipped.get_mut(GZIP_OS_BYTE_OFFSET) {
        *os_byte = GZIP_OS_UNKNOWN;
    }

    Ok(gzipped)
}

fn ustar_archive(entries: &[BundleEntry]) -> Result<Vec<u8>, BundleError> {
    let mut archive = Vec::new();

    for entry in entries {
        archive.extend_from_slice(&ustar_header(entry)?);
        archive.extend_from_slice(&entry.bytes);
        archive.resize(
            archive.len() + ustar_padded(entry.bytes.len()) - entry.bytes.len(),
            0,
        );
    }

    archive.resize(archive.len() + END_OF_ARCHIVE_BLOCKS * USTAR_BLOCK_BYTES, 0);

    Ok(archive)
}

fn ustar_header(entry: &BundleEntry) -> Result<[u8; USTAR_BLOCK_BYTES], BundleError> {
    let split = ustar_path_split(&entry.path).ok_or_else(|| {
        InternalError::new(format!(
            "bundle: '{}' does not fit a ustar header.",
            entry.path
        ))
    })?;
    let size = u64::try_from(entry.bytes.len())
        .map_err(|_| InternalError::new("bundle: a file is larger than a header can hold."))?;
    let mut header = [0_u8; USTAR_BLOCK_BYTES];

    write_text(&mut header, NAME_FIELD, &split.name);
    write_octal(&mut header, MODE_FIELD, FILE_MODE);
    write_octal(&mut header, UID_FIELD, 0);
    write_octal(&mut header, GID_FIELD, 0);
    write_octal(&mut header, SIZE_FIELD, size);
    write_octal(&mut header, MTIME_FIELD, 0);
    write_text(&mut header, TYPE_FIELD, USTAR_TYPE_FILE);
    write_text(&mut header, MAGIC_FIELD, USTAR_MAGIC);
    write_text(&mut header, VERSION_FIELD, USTAR_VERSION);
    write_octal(&mut header, DEVICE_MAJOR_FIELD, 0);
    write_octal(&mut header, DEVICE_MINOR_FIELD, 0);
    write_text(&mut header, PREFIX_FIELD, &split.prefix);
    write_checksum(&mut header);

    Ok(header)
}

/// Writes each UTF-16 code unit of `text`, cut to the field, as its low byte.
fn write_text(header: &mut [u8], field: UstarField, text: &str) {
    for (index, unit) in text.encode_utf16().take(field.length).enumerate() {
        let [low_byte, _] = unit.to_le_bytes();

        if let Some(slot) = header.get_mut(field.offset + index) {
            *slot = low_byte;
        }
    }
}

fn write_octal(header: &mut [u8], field: UstarField, value: u64) {
    let digits = format!("{value:0>width$o}", width = field.length - 1);

    write_text(header, field, &digits);
}

fn write_checksum(header: &mut [u8]) {
    let digits = format!("{:06o}", ustar_checksum(header));

    write_text(header, CHECKSUM_FIELD, &format!("{digits}\0 "));
}
