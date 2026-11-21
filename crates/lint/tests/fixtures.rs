//! The lint of every fixture api that compiles, against the expected `lint/<api>.json` (absent
//! when the api has no diagnostic).

use std::error::Error;
use std::fs;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_compiler::{PipelineOptions, compile_workspace};
use seampact_diagnostics::diagnostic_list_json;
use seampact_json::stringify_json;
use seampact_lint::{RunLintInput, run_lint};
use seampact_load::{FsReader, LoadOptions};
use seampact_oracle::discover_fixtures;

fn repository_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn expected_text(root: &Utf8PathBuf, fixture: &str, api: &str) -> Result<String, Box<dyn Error>> {
    let path = root
        .join("fixtures/expected")
        .join(fixture)
        .join("lint")
        .join(format!("{api}.json"));

    if !path.exists() {
        return Ok("[]".to_owned());
    }

    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;

    Ok(serde_json::to_string(&value)?)
}

#[test]
fn every_fixture_api_lints_to_its_expected_diagnostics() -> Result<(), Box<dyn Error>> {
    let root = repository_root();
    let no_imports = IndexMap::new();
    let mut linted = 0_usize;
    let mut reported = 0_usize;
    let mut differing: Vec<String> = Vec::new();

    for fixture in discover_fixtures(&root)? {
        let reader = FsReader::new(&fixture.directory)?;
        let options = PipelineOptions {
            load: LoadOptions {
                reader: &reader,
                entry: &fixture.entry,
            },
            imports: &no_imports,
        };
        let result = compile_workspace(&options)?;

        for api in &result.apis {
            let (Some(ir), Some(declared)) = (&api.ir, &api.declared) else {
                continue;
            };
            let input = RunLintInput {
                ir,
                declared,
                locations: &api.locations,
                source_files: &result.source_files,
            };
            let diagnostics = run_lint(&input)?;
            let actual: serde_json::Value =
                serde_json::from_str(&stringify_json(&diagnostic_list_json(&diagnostics)))?;

            linted += 1;
            reported += diagnostics.len();

            if serde_json::to_string(&actual)? != expected_text(&root, &fixture.path, &api.api)? {
                differing.push(format!("{}/{}", fixture.path, api.api));
            }
        }
    }

    assert!(linted > 0, "no fixture api was linted");
    assert!(reported > 0, "no fixture api has a diagnostic");
    assert_eq!(differing, Vec::<String>::new(), "{linted} apis linted");

    Ok(())
}
