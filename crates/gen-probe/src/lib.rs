//! Three probe generators that answer what their options say, the stand-in of every family for
//! the oracle's generate and check cases.
//!
//! Each is the twin of a `CommonJS` target under `fixtures/generators/<id>/`; with `echo: true` it
//! writes `request.json`, the request it received. The release binary never links this crate.

mod probe;
mod probe_options;
mod request_echo;
mod unsupported_kind_switch;

pub use probe::Probe;
pub use probe_options::ProbeOptions;
pub use unsupported_kind_switch::UnsupportedKindSwitch;

use seampact_ir::{IR_REVISION, IR_VERSION, IrSupport};
use seampact_target::{
    ArtefactDeclaration, ArtefactDefault, ArtefactId, BasePathRouting, Generator,
    ImportSpecifierStyle, LinkNeed, LinkNeeds, LinkOffers, LinkStyle, MissingNeed, NeedStyles,
    OptionalNeed, TargetId, TargetMetadata, TargetRole, TunableBootCheck,
};

/// The package version of every twin.
const PROBE_VERSION: &str = "1.0.0";

const ROUTES: ArtefactId = ArtefactId::new("routes");
const NATIVE_DOCS: ArtefactId = ArtefactId::new("nativeDocs");
const HOOKS: ArtefactId = ArtefactId::new("hooks");
const QUERIES: ArtefactId = ArtefactId::new("queries");
const MUTATIONS: ArtefactId = ArtefactId::new("mutations");

/// Every declaration kind of the IR, the known values of its `DeclarationKind` open enum.
const ALL_KINDS: &[&str] = &["httpOperation"];

const fn support(kinds: &'static [&'static str]) -> IrSupport<'static> {
    IrSupport {
        ir_versions: &[IR_VERSION],
        ir_revision: IR_REVISION,
        kinds,
        features: &[],
    }
}

/// A server: consumes optional validators, writes routes, native docs and hooks.
pub static PROBE_SERVER: Probe = Probe::new(TargetMetadata {
    id: TargetId::new("probe-server"),
    version: PROBE_VERSION,
    role: TargetRole::Server,
    ir_support: support(ALL_KINDS),
    artefacts: &[
        ArtefactDeclaration {
            id: ROUTES,
            default: ArtefactDefault::On,
            needs: &[],
            missing_need: MissingNeed::Refuse,
        },
        ArtefactDeclaration {
            id: NATIVE_DOCS,
            default: ArtefactDefault::Off,
            needs: &[],
            missing_need: MissingNeed::Refuse,
        },
        ArtefactDeclaration {
            id: HOOKS,
            default: ArtefactDefault::Off,
            needs: &[ROUTES],
            missing_need: MissingNeed::LeaveOff,
        },
    ],
    consumes: LinkNeeds {
        validators: Some(LinkNeed {
            styles: NeedStyles::Listed(&[LinkStyle::StandardSchema, LinkStyle::ClassValidator]),
            optional: Some(OptionalNeed { own_library: "ajv" }),
        }),
        types: None,
        client: None,
    },
    boot_checks: &[TunableBootCheck::FrameworkRoutes, TunableBootCheck::Hooks],
    framework_docs_off_fix: Some("Remove the `probe.docs()` call."),
    base_paths: BasePathRouting::Exclusive,
    runtime_packages: &["probe-runtime"],
    ..TargetMetadata::BASE
});

/// A provider of every kind, whose `describe` answers its options.
pub static PROBE_PROVIDER: Probe = Probe::new(TargetMetadata {
    id: TargetId::new("probe-provider"),
    version: PROBE_VERSION,
    role: TargetRole::Provider,
    ir_support: support(ALL_KINDS),
    provides: LinkOffers {
        validators: Some(LinkStyle::StandardSchema),
        types: Some(LinkStyle::Typescript),
        client: Some(LinkStyle::Fetch),
    },
    ..TargetMetadata::BASE
});

const fn client_metadata(kinds: &'static [&'static str]) -> TargetMetadata {
    TargetMetadata {
        id: TargetId::new("probe-client"),
        version: PROBE_VERSION,
        role: TargetRole::Client,
        ir_support: support(kinds),
        artefacts: &[
            ArtefactDeclaration {
                id: QUERIES,
                default: ArtefactDefault::On,
                needs: &[],
                missing_need: MissingNeed::Refuse,
            },
            ArtefactDeclaration {
                id: MUTATIONS,
                default: ArtefactDefault::On,
                needs: &[QUERIES],
                missing_need: MissingNeed::Refuse,
            },
        ],
        consumes: LinkNeeds {
            validators: None,
            types: Some(LinkNeed {
                styles: NeedStyles::Listed(&[LinkStyle::Typescript]),
                optional: Some(OptionalNeed {
                    own_library: "probe-types",
                }),
            }),
            client: Some(LinkNeed {
                styles: NeedStyles::Listed(&[LinkStyle::Fetch]),
                optional: None,
            }),
        },
        import_specifiers: Some(ImportSpecifierStyle::Extensionless),
        ..TargetMetadata::BASE
    }
}

static PROBE_CLIENT_SUPPORTING: Probe = Probe::new(client_metadata(ALL_KINDS));

static PROBE_CLIENT_REFUSING: Probe = Probe::new(client_metadata(&[]));

/// A client consuming a fetch client and optional types; `unsupportedKind: true` makes it
/// support no declaration kind, so the IR support check refuses the contract.
pub static PROBE_CLIENT: UnsupportedKindSwitch =
    UnsupportedKindSwitch::new(&PROBE_CLIENT_SUPPORTING, &PROBE_CLIENT_REFUSING);

/// The three probes, as the oracle adds them to the registry.
pub static PROBES: [&dyn Generator; 3] = [&PROBE_SERVER, &PROBE_PROVIDER, &PROBE_CLIENT];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_supporting_probes_read_every_declaration_kind() {
        let declaration_kinds = seampact_ir::OPEN_ENUMS
            .iter()
            .find(|entry| entry.definition == "DeclarationKind")
            .map(|entry| entry.known_values);

        assert_eq!(declaration_kinds, Some(ALL_KINDS));
    }
}
