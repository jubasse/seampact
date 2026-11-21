//! The listing of a ustar archive the bundle cases and the CLI transcripts compare: one entry per
//! header, as the TypeScript oracle's `ustarEntries` writes it.

use std::io::Read as _;

use flate2::read::GzDecoder;
use serde_json::{Map, Value};

use crate::{BUNDLE_MANIFEST_FILE, sha256_hex};

/// The size of a ustar header and of the blocks the content is padded to.
const BLOCK: usize = 512;

/// The offset and length of each header field the listing reads (POSIX ustar).
const NAME_FIELD: (usize, usize) = (0, 100);
const MODE_FIELD: (usize, usize) = (100, 8);
const UID_FIELD: (usize, usize) = (108, 8);
const GID_FIELD: (usize, usize) = (116, 8);
const SIZE_FIELD: (usize, usize) = (124, 12);
const MTIME_FIELD: (usize, usize) = (136, 12);
const TYPE_FIELD: (usize, usize) = (156, 1);
const UNAME_FIELD: (usize, usize) = (265, 32);
const GNAME_FIELD: (usize, usize) = (297, 32);
const PREFIX_FIELD: (usize, usize) = (345, 155);

/// The entries of the gzip-compressed ustar archive `archive`, as [`ustar_entries`] lists them.
///
/// # Errors
///
/// When `archive` is no gzip stream.
pub fn gunzipped_ustar_entries(archive: &[u8]) -> Result<Value, String> {
    let mut tar = Vec::new();

    GzDecoder::new(archive)
        .read_to_end(&mut tar)
        .map_err(|error| format!("cannot gunzip the archive: {error}"))?;

    Ok(ustar_entries(&tar))
}

/// The entries of the uncompressed ustar archive `archive`, in archive order:
/// `{ "path", "size", "mode", "uid", "gid", "mtime", "type", "uname", "gname", "sha256" }`, the
/// size and hash left out for the bundle manifest, whose bytes change with the compiler member.
///
/// The listing stops at the first all-zero header or at a header past the end, and a content
/// running past the end is hashed as far as it goes, as the TypeScript reads it.
#[must_use]
pub fn ustar_entries(archive: &[u8]) -> Value {
    let mut entries = Vec::new();
    let mut offset: usize = 0;

    while let Some(header) = archive.get(offset..offset.saturating_add(BLOCK)) {
        if header.iter().all(|byte| *byte == 0) {
            break;
        }

        let name = text_field(header, NAME_FIELD);
        let prefix = text_field(header, PREFIX_FIELD);
        let size = octal_field(header, SIZE_FIELD);
        let path = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let content_size = size
            .as_u64()
            .and_then(|size| usize::try_from(size).ok())
            .unwrap_or(0);
        let content_start = offset.saturating_add(BLOCK);
        let content_end = content_start
            .saturating_add(content_size)
            .min(archive.len());
        let content = archive.get(content_start..content_end).unwrap_or_default();
        let is_manifest = path == BUNDLE_MANIFEST_FILE;

        let mut entry = Map::new();

        entry.insert("path".to_owned(), Value::String(path));

        if !is_manifest {
            entry.insert("size".to_owned(), size);
        }

        entry.insert("mode".to_owned(), octal_field(header, MODE_FIELD));
        entry.insert("uid".to_owned(), octal_field(header, UID_FIELD));
        entry.insert("gid".to_owned(), octal_field(header, GID_FIELD));
        entry.insert("mtime".to_owned(), octal_field(header, MTIME_FIELD));
        entry.insert(
            "type".to_owned(),
            Value::String(text_field(header, TYPE_FIELD)),
        );
        entry.insert(
            "uname".to_owned(),
            Value::String(text_field(header, UNAME_FIELD)),
        );
        entry.insert(
            "gname".to_owned(),
            Value::String(text_field(header, GNAME_FIELD)),
        );

        if !is_manifest {
            entry.insert("sha256".to_owned(), Value::String(sha256_hex(content)));
        }

        entries.push(Value::Object(entry));
        offset = content_start.saturating_add(content_size.div_ceil(BLOCK).saturating_mul(BLOCK));
    }

    Value::Array(entries)
}

/// The field's text up to its first NUL, decoded as UTF-8 with replacement as Node's `Buffer` does.
fn text_field(header: &[u8], (offset, length): (usize, usize)) -> String {
    let field = header
        .get(offset..offset.saturating_add(length))
        .unwrap_or_default();
    let text = String::from_utf8_lossy(field);

    match text.split_once('\0') {
        Some((before_nul, _)) => before_nul.to_owned(),
        None => text.into_owned(),
    }
}

/// The field's octal number as `Number.parseInt(text.trim() || "0", 8)` reads it: the leading
/// octal digits, `null` (the TypeScript's `NaN` once stringified) when there are none.
fn octal_field(header: &[u8], field: (usize, usize)) -> Value {
    let text = text_field(header, field);
    let trimmed = text.trim();
    let digits_text = if trimmed.is_empty() { "0" } else { trimmed };
    let unsigned_text = digits_text.strip_prefix('+').unwrap_or(digits_text);
    let digits: String = unsigned_text
        .chars()
        .take_while(|character| ('0'..='7').contains(character))
        .collect();

    u64::from_str_radix(&digits, 8).map_or(Value::Null, Value::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(name: &str, size: usize, type_flag: u8) -> Vec<u8> {
        let mut block = vec![0_u8; BLOCK];

        block[..name.len()].copy_from_slice(name.as_bytes());
        block[100..107].copy_from_slice(b"0000644");
        block[108..115].copy_from_slice(b"0000000");
        block[116..123].copy_from_slice(b"0000000");
        block[124..135].copy_from_slice(format!("{size:011o}").as_bytes());
        block[136..147].copy_from_slice(b"00000000000");
        block[156] = type_flag;

        block
    }

    #[test]
    fn entries_follow_archive_order_and_skip_the_manifest_size_and_hash() {
        let mut archive = header("sources/api.yaml", 3, b'0');

        archive.extend_from_slice(b"abc");
        archive.resize(2 * BLOCK, 0);
        archive.extend(header(BUNDLE_MANIFEST_FILE, 2, b'0'));
        archive.extend_from_slice(b"{}");
        archive.resize(4 * BLOCK, 0);
        archive.resize(6 * BLOCK, 0);

        let entries = ustar_entries(&archive);

        let expected = serde_json::json!([
            {
                "path": "sources/api.yaml", "size": 3, "mode": 420, "uid": 0, "gid": 0, "mtime": 0,
                "type": "0", "uname": "", "gname": "", "sha256": sha256_hex(b"abc")
            },
            {
                "path": "seampact-bundle.json", "mode": 420, "uid": 0, "gid": 0, "mtime": 0,
                "type": "0", "uname": "", "gname": ""
            }
        ]);

        assert_eq!(entries, expected);
    }

    #[test]
    fn a_field_without_octal_digits_lists_as_null() {
        let mut block = header("a", 0, b'0');

        block[100..107].copy_from_slice(b"xyz\0\0\0\0");

        let entries = ustar_entries(&block);

        assert_eq!(entries[0]["mode"], Value::Null, "entries {entries}");
    }

    #[test]
    fn a_gzip_stream_lists_as_its_tar() {
        use std::io::Write as _;

        let archive = header("a", 0, b'0');
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());

        encoder.write_all(&archive).unwrap();

        let compressed = encoder.finish().unwrap();

        assert_eq!(
            gunzipped_ustar_entries(&compressed).unwrap(),
            ustar_entries(&archive)
        );
        assert!(gunzipped_ustar_entries(b"not gzip").is_err());
    }
}
