//! The read of a committed file that may be missing: a link or a special file is not followed.

use seampact_writer::{WriterError, read_file_if_present};

use crate::support::temporary_directory;

#[test]
fn a_missing_file_is_none_and_a_regular_file_is_its_text() {
    let (_guard, root) = temporary_directory();

    assert_eq!(
        read_file_if_present(&root.join("a.ts")).expect("a missing file"),
        None
    );

    std::fs::write(root.join("a.ts"), "text").expect("a file");

    assert_eq!(
        read_file_if_present(&root.join("a.ts")).expect("a file"),
        Some("text".to_owned())
    );
}

#[test]
fn a_link_in_place_of_the_file_is_refused_and_not_followed() {
    let (_guard, root) = temporary_directory();

    std::fs::write(root.join("target.ts"), "elsewhere").expect("a link target");
    std::os::unix::fs::symlink(root.join("target.ts"), root.join("a.ts")).expect("a link");

    let error = read_file_if_present(&root.join("a.ts")).expect_err("a refused link");

    assert!(
        matches!(&error, WriterError::Io { message, .. } if message == "it is not a regular file"),
        "{error:?}"
    );
}

#[test]
fn a_directory_in_place_of_the_file_is_refused() {
    let (_guard, root) = temporary_directory();

    std::fs::create_dir(root.join("a.ts")).expect("a directory");

    assert!(read_file_if_present(&root.join("a.ts")).is_err());
}
