//! The generator contract shared by the families, the run planning, OpenAPI and the CLI.
//!
//! A family implements [`TargetDefinition`]; the [`Registry`] and the run planning see every
//! generator as a [`Generator`]. A target that produces no file answers [`Refusal`]s, each
//! located by an [`IrLocation`] and built by [`refuse_not_generated_yet`],
//! [`refuse_unknown_value_at`] or [`refuse_inconsistent_ir`].

mod artefacts;
mod compatibility;
mod descriptors;
mod framework_route_check;
mod generate_warning;
mod generator;
mod import_specifier;
mod ir_location;
mod ir_support_refusal;
mod link_check;
mod link_kind;
mod links;
mod located_refusals;
mod metadata;
mod native_docs_document;
mod need_resolution;
mod no_options;
mod not_generated_fixes;
mod parse_options;
mod refusal;
pub mod refusal_code;
mod registry;
mod target_failure;
mod unknown_value;

pub use artefacts::{
    ArtefactDeclaration, ArtefactDefault, ArtefactId, ArtefactSet, MissingNeed,
    artefact_declaration_problems, refuse_undeclared_artefacts,
};
pub use compatibility::{
    CompatibilityError, CompatibilityKey, CompatibilityMatrix, FirstPartyProvider,
    FrameworkSupport, IncompatibleMajor, LibrarySelector, LibrarySupport,
    NativeTargetCompatibility, OwnValidator, PythonFrameworkSupport, PythonIncompatible,
    PythonTargetCompatibility, PythonVersionUnit, TargetCompatibility, TestedMajor, ValidatorPair,
    supported_majors_of,
};
pub use descriptors::{
    ClientDescriptor, ClientErrorStyle, ClientExports, ClientOperationExports, Descriptor,
    DescriptorSet, ExportRef, OperationTypeExports, OperationValidatorExports, SchemaExports,
    TypesDescriptor, ValidatorsDescriptor,
};
pub use framework_route_check::{
    FrameworkRouteAllowance, FrameworkRouteCheck, FrameworkRouteScope, HookBootCheck, NO_MOUNT,
    RouteCheckOrigin, TunableBootCheck,
};
pub use generate_warning::{GenerateWarning, warn_left_to_handler};
pub use generator::{
    GenerateInput, GenerateRequest, Generated, GeneratedFile, Generator, InstalledRuntimes,
    Refused, TargetDefinition,
};
pub use import_specifier::{ImportSpecifierStyle, import_specifier, relative_module_specifier};
pub use ir_location::IrLocation;
pub use ir_support_refusal::refuse_unsupported_ir;
pub use link_check::{meets_every_need, refuse_unmet_links};
pub use link_kind::{LinkKind, LinkStyle};
pub use links::{
    Link, LinkLocation, LinkNeed, LinkNeeds, LinkOffers, LinkSet, NeedStyles, OptionalNeed,
    ResolvedLinkNeed, ResolvedLinkNeeds,
};
pub use located_refusals::{
    refuse_inconsistent_ir, refuse_not_generated_yet, refuse_unknown_value_at,
};
pub use metadata::{BasePathRouting, GENERATOR_VERSION, TargetId, TargetMetadata, TargetRole};
pub use native_docs_document::NativeDocsDocument;
pub use need_resolution::resolve_link_needs;
pub use no_options::NoOptions;
pub use not_generated_fixes::{
    GENERATE_TROUBLESHOOTING_URL, GenerateTroubleshootingSection, LINK_TROUBLESHOOTING_URL,
    NotGeneratedForm, troubleshooting_url,
};
pub use parse_options::parse_options;
pub use refusal::{Refusal, without_repeats};
pub use registry::{
    EXEC_USE, FIRST_PARTY_TARGETS, FirstPartyTarget, Registry, TargetLookupCode,
    TargetLookupProblem,
};
pub use target_failure::TargetFailure;
pub use unknown_value::refuse_unknown_value;
