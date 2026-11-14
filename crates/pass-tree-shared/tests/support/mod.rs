//! A loaded api from inline contract text, as the loader reads it.

use seampact_authoring::RawApi;
use seampact_load::{LoadOptions, MemoryReader, load_workspace};

/// The api of a one-file contract; a load diagnostic fails the test.
pub fn api_of(contract: &str) -> RawApi {
    let reader = MemoryReader::new([("api.yaml".to_owned(), contract.to_owned())]);
    let loaded = load_workspace(&LoadOptions {
        reader: &reader,
        entry: "api.yaml",
    })
    .expect("the loader runs");

    assert!(
        loaded.diagnostics.is_empty(),
        "the inline api does not load: {:?}",
        loaded.diagnostics
    );

    loaded
        .workspace
        .apis
        .into_iter()
        .next()
        .expect("the workspace has an api")
}
