//! The ustar header layout the tarball writer and reader share.

/// The size of a header and of the blocks the content is padded to.
pub(crate) const USTAR_BLOCK_BYTES: usize = 512;

/// A header field: where it starts and how long it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UstarField {
    pub(crate) offset: usize,
    pub(crate) length: usize,
}

const fn field(offset: usize, length: usize) -> UstarField {
    UstarField { offset, length }
}

pub(crate) const NAME_FIELD: UstarField = field(0, 100);
pub(crate) const MODE_FIELD: UstarField = field(100, 8);
pub(crate) const UID_FIELD: UstarField = field(108, 8);
pub(crate) const GID_FIELD: UstarField = field(116, 8);
pub(crate) const SIZE_FIELD: UstarField = field(124, 12);
pub(crate) const MTIME_FIELD: UstarField = field(136, 12);
pub(crate) const CHECKSUM_FIELD: UstarField = field(148, 8);
pub(crate) const TYPE_FIELD: UstarField = field(156, 1);
pub(crate) const MAGIC_FIELD: UstarField = field(257, 6);
pub(crate) const VERSION_FIELD: UstarField = field(263, 2);
pub(crate) const DEVICE_MAJOR_FIELD: UstarField = field(329, 8);
pub(crate) const DEVICE_MINOR_FIELD: UstarField = field(337, 8);
pub(crate) const PREFIX_FIELD: UstarField = field(345, 155);

pub(crate) const USTAR_MAGIC: &str = "ustar\0";
pub(crate) const USTAR_VERSION: &str = "00";

/// GNU tar's magic and version, one 8-byte field.
pub(crate) const GNU_MAGIC_AND_VERSION: &str = "ustar  \0";

pub(crate) const USTAR_TYPE_FILE: &str = "0";

/// Pre-POSIX archives mark a regular file with a NUL type.
pub(crate) const USTAR_TYPE_FILE_OLD: &str = "\0";
pub(crate) const USTAR_TYPE_DIRECTORY: &str = "5";
pub(crate) const PAX_TYPE_EXTENDED: &str = "x";
pub(crate) const PAX_TYPE_GLOBAL: &str = "g";

/// A byte of a header's checksum field counts as a space.
const SPACE: u8 = 0x20;

/// The sum of the header's bytes with the checksum field read as spaces.
pub(crate) fn ustar_checksum(header: &[u8]) -> u64 {
    let checksum = CHECKSUM_FIELD.offset..CHECKSUM_FIELD.offset + CHECKSUM_FIELD.length;

    (0..USTAR_BLOCK_BYTES)
        .map(|index| {
            if checksum.contains(&index) {
                return u64::from(SPACE);
            }

            u64::from(header.get(index).copied().unwrap_or(0))
        })
        .sum()
}

/// `size` rounded up to whole blocks.
pub(crate) fn ustar_padded(size: usize) -> usize {
    size.div_ceil(USTAR_BLOCK_BYTES)
        .saturating_mul(USTAR_BLOCK_BYTES)
}

/// A path split into the header's prefix and name fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UstarPathSplit {
    pub(crate) prefix: String,
    pub(crate) name: String,
}

fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// How `path` fits a header: whole in the name field, else split at a slash, or `None`.
pub(crate) fn ustar_path_split(path: &str) -> Option<UstarPathSplit> {
    if utf16_length(path) <= NAME_FIELD.length {
        return Some(UstarPathSplit {
            prefix: String::new(),
            name: path.to_owned(),
        });
    }

    path.match_indices('/').find_map(|(slash, _)| {
        let (prefix, rest) = path.split_at_checked(slash)?;
        let name = rest.strip_prefix('/')?;
        let fits = utf16_length(prefix) <= PREFIX_FIELD.length
            && utf16_length(name) <= NAME_FIELD.length
            && !name.is_empty();

        fits.then(|| UstarPathSplit {
            prefix: prefix.to_owned(),
            name: name.to_owned(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_splits_at_the_first_slash_that_fits() {
        let long_name = "n".repeat(100);

        assert_eq!(
            ustar_path_split(&format!("sources/{long_name}")),
            Some(UstarPathSplit {
                prefix: "sources".to_owned(),
                name: long_name
            })
        );
        assert_eq!(ustar_path_split(&"a".repeat(101)), None);
        assert!(ustar_path_split(&"b".repeat(100)).is_some_and(|split| split.prefix.is_empty()));
    }

    #[test]
    fn the_padding_rounds_up_to_a_block() {
        assert_eq!(ustar_padded(0), 0);
        assert_eq!(ustar_padded(1), 512);
        assert_eq!(ustar_padded(512), 512);
        assert_eq!(ustar_padded(513), 1024);
    }
}
