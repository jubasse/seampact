//! The checks the TypeScript ran at load or by its types, over every generator of the registry.

use seampact_gen_probe::PROBES;
use seampact_generators::registry;
use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use seampact_target::{FIRST_PARTY_TARGETS, Registry, artefact_declaration_problems};

/// The first-party generators and the probes, so the checks run before the first family lands.
fn every_generator() -> Registry {
    registry().with(&PROBES)
}

#[test]
fn every_generator_declares_valid_artefacts() {
    for generator in every_generator().generators() {
        let metadata = generator.metadata();

        assert_eq!(
            artefact_declaration_problems(metadata.artefacts),
            Vec::<String>::new(),
            "generator {}",
            metadata.id
        );
    }
}

#[test]
fn every_first_party_generator_has_a_first_party_short_id() {
    for generator in registry().generators() {
        let id = generator.metadata().id;

        assert!(
            FIRST_PARTY_TARGETS.iter().any(|target| target.id == id),
            "generator {id}"
        );
    }
}

#[test]
fn every_first_party_provider_describes_each_kind_it_provides() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/expected/reference/ir/tasks.json"
    ))
    .unwrap();
    let ir = ContractIr::from_json_text(&text).unwrap();
    let no_options = JsonValue::Object(seampact_json::JsonObject::new());

    // The probes describe what their options say, so only the first-party providers are held to
    // describing every provided kind with no options.
    for generator in registry().generators() {
        let metadata = generator.metadata();
        let descriptors = generator.describe(&ir, &no_options).unwrap();

        for kind in metadata.provides.kinds() {
            assert!(
                descriptors.of(kind).is_some(),
                "generator {} provides {} but does not describe it",
                metadata.id,
                kind.as_str()
            );
        }
    }
}

#[test]
fn the_build_registry_resolves_no_probe() {
    for probe in PROBES {
        let probe_id = probe.metadata().id.as_str();

        assert!(
            registry().lookup(probe_id).is_err(),
            "the build registry resolves the probe {probe_id}"
        );
    }
}
