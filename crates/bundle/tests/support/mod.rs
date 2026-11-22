//! Shared helper of the integration tests: the repository root.

use camino::Utf8PathBuf;

/// The repository root, two levels above the crate.
#[allow(dead_code, reason = "each test file uses its own helpers")]
pub fn repository_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A new empty directory under the system temporary directory, named after the test.
#[allow(
    dead_code,
    clippy::unwrap_used,
    reason = "each test file uses its own helpers; a failed setup is the failed test"
)]
pub fn scratch_directory(name: &str) -> Utf8PathBuf {
    let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "seampact-bundle-test-{}-{name}",
            std::process::id()
        ));

    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();

    directory
}

/// The bytes of standard base64 text.
#[allow(
    dead_code,
    clippy::unwrap_used,
    reason = "each test file uses its own helpers; a bad vector is the failed test"
)]
pub fn base64_decoded(text: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut group = 0_u32;
    let mut count = 0;

    for character in text.chars().filter(|c| *c != '=') {
        let sextet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            .find(character)
            .unwrap();

        group = group << 6 | u32::try_from(sextet).unwrap();
        count += 1;

        if count == 4 {
            bytes.extend_from_slice(&group.to_be_bytes()[1..]);
            group = 0;
            count = 0;
        }
    }

    match count {
        2 => bytes.push(u8::try_from((group >> 4) & 0xff).unwrap()),
        3 => bytes.extend_from_slice(&[
            u8::try_from((group >> 10) & 0xff).unwrap(),
            u8::try_from((group >> 2) & 0xff).unwrap(),
        ]),
        _ => {}
    }

    bytes
}
