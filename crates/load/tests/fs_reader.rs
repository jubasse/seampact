//! `FsReader` on a real directory: reading, listing, real paths and the paths that must not leave
//! the workspace root.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_load::{
    FsReader, FsReaderError, LoadReader, LoadText, PathProblem, is_inside, load_normalize_path,
};
use tempfile::TempDir;

mod support;

use support::{Outcome, resolve_in};

type TestResult = Result<(), Box<dyn std::error::Error>>;

/// A directory `base` holding a workspace `ws` and a file `secret.yaml` next to it.
struct Disk {
    _guard: TempDir,
    base: Utf8PathBuf,
    root: Utf8PathBuf,
}

fn disk() -> Result<Disk, Box<dyn std::error::Error>> {
    let guard = tempfile::tempdir()?;
    let base = Utf8PathBuf::from_path_buf(fs::canonicalize(guard.path())?)
        .map_err(|path| format!("the temporary directory {} is not UTF-8", path.display()))?;
    let root = base.join("ws");

    fs::create_dir(&root)?;
    fs::write(base.join("secret.yaml"), "stolen: 1\n")?;
    fs::write(root.join("api.yaml"), "api: { name: t }\n")?;
    fs::create_dir(root.join("sub"))?;
    fs::write(root.join("sub/x.yaml"), "ok: 1\n")?;

    Ok(Disk {
        _guard: guard,
        base,
        root,
    })
}

fn reader_of(disk: &Disk) -> Result<FsReader, FsReaderError> {
    FsReader::new(&disk.root)
}

fn resolve_on_disk(reader: &FsReader, from_file: &str, raw: &str) -> Outcome {
    resolve_in(reader, from_file, raw, ".")
}

#[test]
fn a_file_is_read_and_a_directory_or_a_missing_file_is_not() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    assert_eq!(
        reader.read_text("api.yaml", 1000),
        Some(LoadText::Text("api: { name: t }\n".to_owned()))
    );
    assert_eq!(reader.read_text("sub", 1000), None);
    assert_eq!(reader.read_text("nope.yaml", 1000), None);

    Ok(())
}

#[test]
fn a_file_over_the_cap_is_too_large_and_one_at_the_cap_is_read() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    fs::write(disk.root.join("ten.txt"), "0123456789")?;

    assert_eq!(reader.read_text("ten.txt", 9), Some(LoadText::TooLarge));
    assert_eq!(
        reader.read_text("ten.txt", 10),
        Some(LoadText::Text("0123456789".to_owned()))
    );
    assert_eq!(reader.read_text("ten.txt", 0), Some(LoadText::TooLarge));

    Ok(())
}

#[test]
fn one_leading_byte_order_mark_is_stripped_and_invalid_bytes_become_replacement_characters()
-> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    fs::write(disk.root.join("bom.yaml"), b"\xEF\xBB\xBFa: 1\n")?;
    fs::write(
        disk.root.join("two-boms.yaml"),
        b"\xEF\xBB\xBF\xEF\xBB\xBFa\n",
    )?;
    fs::write(disk.root.join("invalid.yaml"), b"a\xFFb\xC3\n")?;
    fs::write(disk.root.join("empty.yaml"), b"")?;

    assert_eq!(
        reader.read_text("bom.yaml", 100),
        Some(LoadText::Text("a: 1\n".to_owned()))
    );
    assert_eq!(
        reader.read_text("two-boms.yaml", 100),
        Some(LoadText::Text("\u{FEFF}a\n".to_owned()))
    );
    assert_eq!(
        reader.read_text("invalid.yaml", 100),
        Some(LoadText::Text("a\u{FFFD}b\u{FFFD}\n".to_owned()))
    );
    assert_eq!(
        reader.read_text("empty.yaml", 100),
        Some(LoadText::Text(String::new()))
    );

    Ok(())
}

#[test]
fn a_directory_lists_its_names_in_utf16_order() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    for name in [
        "z.yaml",
        "\u{E000}.yaml",
        "\u{1F600}.yaml",
        "B.yaml",
        "a.yaml",
    ] {
        fs::write(disk.root.join("sub").join(name), "")?;
    }

    assert_eq!(
        reader.list_dir("sub"),
        Some(
            [
                "B.yaml",
                "a.yaml",
                "x.yaml",
                "z.yaml",
                "\u{1F600}.yaml",
                "\u{E000}.yaml"
            ]
            .map(str::to_owned)
            .to_vec()
        )
    );
    assert_eq!(reader.list_dir("api.yaml"), None);
    assert_eq!(reader.list_dir("nope"), None);

    Ok(())
}

#[test]
fn real_paths_are_root_relative_and_a_missing_file_has_none() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    assert_eq!(reader.real_path("."), Some(".".to_owned()));
    assert_eq!(
        reader.real_path("sub/x.yaml"),
        Some("sub/x.yaml".to_owned())
    );
    assert_eq!(
        reader.real_path("sub/../api.yaml"),
        Some("api.yaml".to_owned())
    );
    assert_eq!(
        reader.real_path("../ws/api.yaml"),
        Some("api.yaml".to_owned())
    );
    assert_eq!(
        reader.real_path("../secret.yaml"),
        Some("../secret.yaml".to_owned())
    );
    assert_eq!(reader.real_path("nope.yaml"), None);

    Ok(())
}

#[test]
fn the_ascent_is_the_number_of_directories_above_the_root() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;
    let directories = disk
        .root
        .components()
        .filter(|component| matches!(component, camino::Utf8Component::Normal(_)))
        .count();

    assert_eq!(usize::try_from(reader.ascent())?, directories);

    Ok(())
}

#[test]
fn a_missing_root_is_an_error_naming_it() -> TestResult {
    let disk = disk()?;
    let missing = disk.base.join("nowhere");

    let Err(error) = FsReader::new(&missing) else {
        return Err("a missing root must be refused".into());
    };

    assert!(matches!(error, FsReaderError::Root { .. }));
    assert!(error.to_string().contains("nowhere"), "{error}");

    Ok(())
}

#[test]
fn an_entry_file_outside_the_root_is_refused() {
    assert!(!is_inside(".", &load_normalize_path("../api.yaml")));
    assert!(!is_inside(".", &load_normalize_path("sub/../../api.yaml")));
    assert!(is_inside(".", &load_normalize_path("sub/../api.yaml")));
}

#[test]
fn a_path_that_climbs_out_of_the_root_is_refused_before_the_disk_is_read() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    assert_eq!(
        resolve_on_disk(&reader, "api.yaml", "../secret.yaml"),
        Outcome::Refused(PathProblem::Escape)
    );
    assert_eq!(
        resolve_on_disk(&reader, "sub/x.yaml", "../../secret.yaml"),
        Outcome::Refused(PathProblem::Escape)
    );
    assert_eq!(
        resolve_on_disk(&reader, "api.yaml", "./sub/../../secret.yaml"),
        Outcome::Refused(PathProblem::Escape)
    );

    Ok(())
}

#[test]
fn a_file_inside_the_root_resolves_and_a_wrong_case_names_the_file_on_disk() -> TestResult {
    let disk = disk()?;
    let reader = reader_of(&disk)?;

    assert_eq!(
        resolve_on_disk(&reader, "api.yaml", "./sub/x.yaml"),
        Outcome::Real("sub/x.yaml".to_owned())
    );
    assert_eq!(
        resolve_on_disk(&reader, "api.yaml", "./Sub/X.yaml"),
        Outcome::Case("sub/x.yaml".to_owned())
    );
    assert_eq!(
        resolve_on_disk(&reader, "api.yaml", "./sub/y.yaml"),
        Outcome::Missing
    );

    Ok(())
}

#[cfg(unix)]
mod symbolic_links {
    use std::os::unix::fs::symlink;

    use super::*;

    fn disk_with_links() -> Result<Disk, Box<dyn std::error::Error>> {
        let disk = disk()?;

        symlink(disk.base.join("secret.yaml"), disk.root.join("link.yaml"))?;
        symlink(&disk.base, disk.root.join("dirlink"))?;
        symlink("sub/x.yaml", disk.root.join("inner.yaml"))?;
        symlink("sub", disk.root.join("innerdir"))?;

        Ok(disk)
    }

    #[test]
    fn a_symlink_out_of_the_root_is_refused() -> TestResult {
        let disk = disk_with_links()?;
        let reader = reader_of(&disk)?;

        assert_eq!(
            resolve_on_disk(&reader, "api.yaml", "./link.yaml"),
            Outcome::Escaped
        );
        assert_eq!(
            resolve_on_disk(&reader, "api.yaml", "./dirlink/secret.yaml"),
            Outcome::Escaped
        );

        Ok(())
    }

    #[test]
    fn a_real_path_through_a_link_out_of_the_root_is_relative_never_absolute() -> TestResult {
        let disk = disk_with_links()?;
        let reader = reader_of(&disk)?;

        assert_eq!(
            reader.real_path("link.yaml"),
            Some("../secret.yaml".to_owned())
        );
        assert_eq!(
            reader.real_path("dirlink/secret.yaml"),
            Some("../secret.yaml".to_owned())
        );

        for file in ["link.yaml", "dirlink", "dirlink/secret.yaml"] {
            let real = reader.real_path(file).unwrap_or_default();

            assert!(
                !real.contains(disk.base.as_str()),
                "the real path {real:?} names the disk"
            );
        }

        Ok(())
    }

    #[test]
    fn a_symlink_inside_the_root_resolves_to_its_target() -> TestResult {
        let disk = disk_with_links()?;
        let reader = reader_of(&disk)?;

        assert_eq!(
            resolve_on_disk(&reader, "api.yaml", "./inner.yaml"),
            Outcome::Real("sub/x.yaml".to_owned())
        );
        assert_eq!(
            resolve_on_disk(&reader, "api.yaml", "./innerdir/x.yaml"),
            Outcome::Real("sub/x.yaml".to_owned())
        );
        assert_eq!(
            reader.read_text("link.yaml", 100),
            Some(LoadText::Text("stolen: 1\n".to_owned()))
        );

        Ok(())
    }

    #[test]
    fn a_root_given_as_a_symlink_is_resolved_to_its_real_path() -> TestResult {
        let disk = disk_with_links()?;
        let through_link = disk.base.join("ws-link");

        symlink(&disk.root, &through_link)?;

        let reader = FsReader::new(Utf8Path::new(through_link.as_str()))?;

        assert_eq!(reader.real_path("."), Some(".".to_owned()));
        assert_eq!(
            reader.real_path("../secret.yaml"),
            Some("../secret.yaml".to_owned())
        );

        Ok(())
    }

    #[test]
    fn a_dangling_link_is_missing() -> TestResult {
        let disk = disk()?;

        symlink("nowhere.yaml", disk.root.join("dangling.yaml"))?;

        let reader = reader_of(&disk)?;

        assert_eq!(reader.read_text("dangling.yaml", 100), None);
        assert_eq!(reader.real_path("dangling.yaml"), None);

        Ok(())
    }
}
