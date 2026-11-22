//! The SHA-256 of a file and the integrity of a bundle.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::BundleFile;
use crate::file_list::canonical_bundle_file_list;

/// The integrity's prefix, the form npm's SRI uses.
pub const BUNDLE_INTEGRITY_PREFIX: &str = "sha256-";

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BITS_PER_BASE64_CHARACTER: u32 = 6;
const BITS_PER_BYTE: u32 = 8;

/// The lowercase hexadecimal SHA-256 of a file's bytes.
#[must_use]
pub fn bundle_sha256_hex(bytes: &[u8]) -> String {
    bundle_hex(&Sha256::digest(bytes))
}

/// The lowercase hexadecimal text of `bytes`.
#[must_use]
pub fn bundle_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02x}");

        hex
    })
}

/// The bytes of base64 characters, leftover bits dropped, as `Buffer.from(text, "base64")`;
/// `None` for a character outside the alphabet.
#[must_use]
pub fn bundle_base64_decoded(characters: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut accumulated: u32 = 0;
    let mut bits: u32 = 0;

    for character in characters.chars().filter(|character| *character != '=') {
        let sextet = BASE64_ALPHABET
            .iter()
            .position(|byte| char::from(*byte) == character)?;

        accumulated = (accumulated << BITS_PER_BASE64_CHARACTER) | u32::try_from(sextet).ok()?;
        bits += BITS_PER_BASE64_CHARACTER;

        if bits >= BITS_PER_BYTE {
            bits -= BITS_PER_BYTE;
            bytes.push(u8::try_from((accumulated >> bits) & 0xff).ok()?);
            accumulated &= (1 << bits) - 1;
        }
    }

    Some(bytes)
}

/// The padded standard base64 of `bytes`.
fn standard_base64(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let [first, second, third] = [0, 1, 2].map(|at| chunk.get(at).copied());
        let group = u32::from(first.unwrap_or(0)) << 16
            | u32::from(second.unwrap_or(0)) << 8
            | u32::from(third.unwrap_or(0));
        let kept = chunk.len() + 1;

        for position in 0..4_usize {
            if position >= kept {
                text.push('=');

                continue;
            }

            let shift = 18 - 6 * position;
            let sextet = usize::try_from((group >> shift) & 0x3f).unwrap_or(0);

            text.extend(BASE64_ALPHABET.get(sextet).map(|byte| char::from(*byte)));
        }
    }

    text
}

/// `sha256-` and the base64 of the SHA-256 of the canonical file list of `files`.
#[must_use]
pub fn bundle_integrity(files: &[BundleFile]) -> String {
    let digest = Sha256::digest(canonical_bundle_file_list(files).as_bytes());

    format!("{BUNDLE_INTEGRITY_PREFIX}{}", standard_base64(&digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_pads_each_remainder_length() {
        assert_eq!(standard_base64(b""), "");
        assert_eq!(standard_base64(b"f"), "Zg==");
        assert_eq!(standard_base64(b"fo"), "Zm8=");
        assert_eq!(standard_base64(b"foo"), "Zm9v");
        assert_eq!(standard_base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_drops_the_leftover_bits_of_a_last_character() {
        assert_eq!(bundle_base64_decoded("AB"), Some(vec![0]));
        assert_eq!(bundle_base64_decoded("//"), Some(vec![0xff]));
        assert_eq!(bundle_base64_decoded("A-"), None);
    }

    #[test]
    fn the_integrity_of_no_file_is_the_hash_of_the_empty_text() {
        assert_eq!(
            bundle_integrity(&[]),
            "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
        );
    }
}
