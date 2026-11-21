//! `buildBundle` and `writeBundle` over in-memory workspaces: packs, line ends, labels, one read
//! per file, the output directory and the tarball's fixed bytes.

#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

use std::cell::RefCell;
use std::collections::HashMap;

use camino::Utf8PathBuf;
use seampact_bundle::{
    BundleArchiveRead, BundleBuildOptions, BundleBuildResult, BundleContents, BundleFailureCode,
    BundleNamedVersion, BundleNamedVersionOverride, BundleOutput, BundleWriteOptions,
    BundleWriteResult, bundle_tarball, read_bundle_tarball, write_bundle,
};
use seampact_load::{LoadReader, LoadText, MemoryReader};

const PACKAGE: &str = r#"{"name":"@acme/contract","version":"3.1.0"}"#;
const PACK_PACKAGE: &str = r#"{"name":"@acme/pack-a","version":"1.2.0","seampact":{"role":"pack","pack":"lib/pack.yaml"}}"#;
const API: &str = "api: { name: t, version: 1 }\npacks: ['@acme/pack-a']\n";
const PACK: &str = "pack: { name: '@acme/pack-a', version: 1.2.0 }\nrights:\n  r.one: {}\nconventions:\n  paging: { default: cursor }\n";

fn pack_contract(line_end: &str) -> Vec<(String, String)> {
    [
        ("package.json", PACKAGE),
        ("api.yaml", API),
        ("node_modules/@acme/pack-a/package.json", PACK_PACKAGE),
        ("node_modules/@acme/pack-a/lib/pack.yaml", PACK),
    ]
    .into_iter()
    .map(|(file, text)| (file.to_owned(), text.replace('\n', line_end)))
    .collect()
}

fn built(
    reader: &dyn LoadReader,
    contract: Option<BundleNamedVersionOverride>,
) -> BundleBuildResult {
    seampact_bundle::build_bundle(&BundleBuildOptions {
        reader,
        entry: "api.yaml",
        contract,
    })
    .unwrap()
}

fn contents_of(reader: &dyn LoadReader) -> BundleContents {
    match built(reader, None) {
        BundleBuildResult::Built { contents, .. } => *contents,
        BundleBuildResult::Failed { failures, .. } => panic!("not built: {failures:?}"),
    }
}

#[test]
fn a_contract_applying_an_npm_pack_vendors_it() {
    let contents = contents_of(&MemoryReader::new(pack_contract("\n")));
    let mut paths: Vec<&str> = contents.files.keys().map(String::as_str).collect();

    paths.sort_unstable();

    assert_eq!(
        paths,
        [
            "ir/t.json",
            "sources/.packs/@acme/pack-a@1.2.0/lib/pack.yaml",
            "sources/.packs/@acme/pack-a@1.2.0/package.json",
            "sources/api.yaml",
        ]
    );
    assert_eq!(
        *contents.manifest.contract,
        BundleNamedVersion {
            name: "@acme/contract".to_owned(),
            version: "3.1.0".to_owned()
        }
    );
    assert_eq!(
        contents.manifest.packs,
        [BundleNamedVersion {
            name: "@acme/pack-a".to_owned(),
            version: "1.2.0".to_owned()
        }]
    );
}

#[test]
fn a_contract_checked_out_with_crlf_gives_the_bundle_of_its_lf_checkout() {
    let lf = contents_of(&MemoryReader::new(pack_contract("\n")));
    let crlf = contents_of(&MemoryReader::new(pack_contract("\r\n")));

    assert_eq!(crlf.manifest.integrity, lf.manifest.integrity);
    assert_eq!(crlf.files, lf.files);
}

#[test]
fn a_label_outside_printable_ascii_is_refused_before_it_is_written() {
    for name in ["", "acme contract"] {
        let reader = MemoryReader::new(pack_contract("\n"));
        let BundleBuildResult::Failed { failures, .. } = built(
            &reader,
            Some(BundleNamedVersionOverride {
                name: Some(name.to_owned()),
                version: None,
            }),
        ) else {
            panic!("name {name:?} was accepted");
        };
        let codes: Vec<BundleFailureCode> = failures.iter().map(|failure| failure.code).collect();

        assert_eq!(codes, [BundleFailureCode::LabelInvalid], "name {name:?}");
    }
}

/// Answers a second read of `api.yaml` with an edited text.
struct EditingReader {
    memory: MemoryReader,
    reads: RefCell<HashMap<String, u32>>,
}

impl LoadReader for EditingReader {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<LoadText> {
        let count = {
            let mut reads = self.reads.borrow_mut();
            let count = reads.entry(file.to_owned()).or_insert(0);

            *count += 1;

            *count
        };

        match self.memory.read_text(file, max_bytes)? {
            LoadText::Text(text) if file == "api.yaml" && count > 1 => {
                Some(LoadText::Text(format!("{text}# edited\n")))
            }
            other => Some(other),
        }
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        self.memory.list_dir(dir)
    }

    fn real_path(&self, file: &str) -> Option<String> {
        self.memory.real_path(file)
    }

    fn ascent(&self) -> u32 {
        self.memory.ascent()
    }
}

#[test]
fn the_bundle_carries_the_text_the_ir_was_compiled_from_never_a_second_read() {
    let reader = EditingReader {
        memory: MemoryReader::new(pack_contract("\n")),
        reads: RefCell::new(HashMap::new()),
    };
    let contents = contents_of(&reader);

    assert_eq!(
        contents.files.get("sources/api.yaml").map(Vec::as_slice),
        Some(API.as_bytes())
    );
}

fn unique_directory(name: &str) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "seampact-bundle-test-{}-{name}",
            std::process::id()
        ))
}

#[test]
fn a_directory_output_must_be_new_or_empty() {
    let output = unique_directory("output");
    let reader = MemoryReader::new(pack_contract("\n"));
    let options = || BundleWriteOptions {
        build: BundleBuildOptions {
            reader: &reader,
            entry: "api.yaml",
            contract: None,
        },
        output: BundleOutput::Directory(output.clone()),
    };

    assert!(matches!(
        write_bundle(&options()).unwrap(),
        BundleWriteResult::Written { .. }
    ));

    let BundleWriteResult::Failed { failures, .. } = write_bundle(&options()).unwrap() else {
        panic!("a second write into the same directory was accepted");
    };

    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].code, BundleFailureCode::OutputNotEmpty);
    assert_eq!(failures[0].file.as_deref(), Some(output.as_str()));

    std::fs::remove_dir_all(&output).unwrap();
}

#[test]
fn the_tarball_has_fixed_gzip_metadata_and_reads_back_in_path_order() {
    let contents = contents_of(&MemoryReader::new(pack_contract("\n")));
    let tarball = bundle_tarball(&contents).unwrap();

    assert_eq!(tarball.get(4..10), Some(&[0, 0, 0, 0, 2, 255][..]));
    assert_eq!(
        bundle_tarball(&contents).unwrap(),
        tarball,
        "same contents, same bytes"
    );

    let BundleArchiveRead::Entries(entries) = read_bundle_tarball(&tarball) else {
        panic!("the tarball is refused");
    };
    let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();

    assert_eq!(
        paths,
        [
            "ir/t.json",
            "seampact-bundle.json",
            "sources/.packs/@acme/pack-a@1.2.0/lib/pack.yaml",
            "sources/.packs/@acme/pack-a@1.2.0/package.json",
            "sources/api.yaml",
        ]
    );
}
