//! The registry of the oracle's runs: the build's generators and the three probes.

use seampact_gen_probe::PROBES;
use seampact_target::{FIRST_PARTY_TARGETS, Registry};

/// The build's registry extended with the probes, so `use: probe-server` resolves.
pub(crate) fn oracle_registry() -> Registry {
    seampact_generators::registry().with(&PROBES)
}

/// The short id a 1.x package name stands for: a generator of the oracle's registry first, then
/// every first-party target this build has no generator for yet.
pub(crate) fn short_id_of_package(package_name: &str) -> Option<String> {
    let registered = oracle_registry().generators().find_map(|generator| {
        let metadata = generator.metadata();

        metadata
            .legacy_names
            .contains(&package_name)
            .then(|| metadata.id.as_str().to_owned())
    });

    registered.or_else(|| {
        FIRST_PARTY_TARGETS
            .iter()
            .find(|target| target.legacy_names.contains(&package_name))
            .map(|target| target.id.as_str().to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_1x_package_name_maps_to_its_short_id() {
        assert_eq!(
            short_id_of_package("@seampact/codegen-adonis").as_deref(),
            Some("adonis")
        );
        assert_eq!(short_id_of_package("probe-server"), None);
    }

    #[test]
    fn the_oracle_registry_resolves_the_probes() {
        assert!(oracle_registry().lookup("probe-server").is_ok());
    }
}
