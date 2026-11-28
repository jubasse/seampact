//! The SHA-256 of bytes as the manifest writes it.

use std::fmt::Write as _;
use std::fs::File;
use std::io::{self, Read};

use camino::Utf8Path;
use sha2::{Digest, Sha256};

const READ_BUFFER_BYTES: usize = 64 * 1024;

/// The lowercase hexadecimal SHA-256 of `bytes`.
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex_of(Sha256::digest(bytes).as_slice())
}

/// The lowercase hexadecimal SHA-256 of the file at `path`, read in chunks, never whole.
pub(crate) fn sha256_hex_of_file(path: &Utf8Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; READ_BUFFER_BYTES];

    loop {
        let read = file.read(&mut buffer)?;

        let Some(chunk) = buffer.get(..read).filter(|chunk| !chunk.is_empty()) else {
            return Ok(hex_of(hasher.finalize().as_slice()));
        };

        hasher.update(chunk);
    }
}

fn hex_of(digest: &[u8]) -> String {
    digest.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_larger_than_the_buffer_has_the_digest_of_its_bytes() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let path = Utf8Path::from_path(directory.path())
            .expect("a UTF-8 temporary path")
            .join("big");
        let bytes: Vec<u8> = (0..READ_BUFFER_BYTES * 2 + 17)
            .map(|index| u8::try_from(index % 251).unwrap_or(0))
            .collect();

        std::fs::write(&path, &bytes).expect("a written file");

        assert_eq!(
            sha256_hex_of_file(&path).expect("a hashed file"),
            sha256_hex(&bytes)
        );
    }

    #[test]
    fn the_digest_of_abc_is_the_known_one() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
