//! Helpers the writer's tests share: a temporary output directory and generated files.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_target::GeneratedFile;
use tempfile::TempDir;

pub fn temporary_directory() -> (TempDir, Utf8PathBuf) {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let path = Utf8PathBuf::from_path_buf(
        directory
            .path()
            .canonicalize()
            .expect("the real path of the temporary directory"),
    )
    .expect("a UTF-8 temporary path");

    (directory, path)
}

pub fn file(path: &str, contents: &str) -> GeneratedFile {
    GeneratedFile {
        path: path.to_owned(),
        contents: contents.to_owned(),
    }
}

pub fn read(path: &Utf8Path) -> String {
    std::fs::read_to_string(path).expect("a readable file")
}
