//! The generator contract: IR and options in, files, warnings or refusals out.

use std::collections::BTreeMap;
use std::fmt;

use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    ArtefactSet, DescriptorSet, FrameworkRouteCheck, GenerateWarning, HookBootCheck,
    ImportSpecifierStyle, LinkSet, NO_MOUNT, NativeDocsDocument, Refusal, ResolvedLinkNeeds,
    TargetFailure, TargetMetadata, refuse_undeclared_artefacts, refuse_unmet_links,
    refuse_unsupported_ir,
};

/// One file a generator writes; the writer checks the path.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeneratedFile {
    /// The path, relative to the entry's output directory.
    pub path: String,
    /// The text.
    pub contents: String,
}

/// What a generator answers when it writes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Generated {
    /// The files.
    pub files: Vec<GeneratedFile>,
    /// The forms left to the developer's code.
    pub warnings: Vec<GenerateWarning>,
}

/// The refusals of a generator that writes no file.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use]
pub struct Refused(pub Vec<Refusal>);

impl fmt::Display for Refused {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let codes: Vec<&str> = self.0.iter().map(|refusal| refusal.code.as_str()).collect();

        write!(formatter, "refused: {}", codes.join(", "))
    }
}

impl std::error::Error for Refused {}

/// The `version` of each runtime package of a target installed for the entry, by package name,
/// as its `package.json` writes it; `null` when the package is not installed or writes none. Read
/// by the run planning, so a generator does no file I/O.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct InstalledRuntimes(BTreeMap<String, JsonValue>);

impl InstalledRuntimes {
    /// No runtime package.
    pub const NONE: Self = Self(BTreeMap::new());

    /// Records the `version` `package` writes, `null` for none.
    pub fn insert(&mut self, package: String, version: JsonValue) {
        self.0.insert(package, version);
    }

    /// The version of `package` as written: `None` when the package was not read, `null` when it
    /// is not installed.
    #[must_use]
    pub fn written(&self, package: &str) -> Option<&JsonValue> {
        self.0.get(package)
    }

    /// The installed version of `package` as text: `None` when the package was not read, not
    /// installed, or writes a version that is not text (see [`Self::written`]).
    #[must_use]
    pub fn version(&self, package: &str) -> Option<&str> {
        match self.0.get(package) {
            Some(JsonValue::String(version)) => Some(version),
            _ => None,
        }
    }
}

/// What the run planning hands a generator for one entry and api, borrowed for the run.
#[derive(Debug, Clone, Copy)]
#[non_exhaustive]
pub struct GenerateRequest<'run> {
    /// The api's IR, filtered to the entry's operations.
    pub ir: &'run ContractIr,
    /// The entry's raw options.
    pub options: Option<&'run JsonValue>,
    /// The target's needs, styles read.
    pub needs: &'run ResolvedLinkNeeds,
    /// The links of the entry.
    pub links: &'run LinkSet,
    /// The switched-on artefacts.
    pub artefacts: &'run ArtefactSet,
    /// The entry's framework-route check; the default check when absent.
    pub framework_routes: Option<&'run FrameworkRouteCheck>,
    /// The entry's hook boot check level; `error` when absent.
    pub hook_check: Option<HookBootCheck>,
    /// The entry's `mount`; no prefix when absent.
    pub mount: Option<&'run str>,
    /// The import style of the consumers a provider is linked to; the target's own when absent.
    pub import_specifiers: Option<ImportSpecifierStyle>,
    /// The parsed document the `nativeDocs` artefact follows.
    pub native_docs_document: Option<&'run NativeDocsDocument>,
    /// The installed versions of the target's runtime packages.
    pub installed_runtimes: &'run InstalledRuntimes,
}

static NO_NEEDS: ResolvedLinkNeeds = ResolvedLinkNeeds::NONE;
static NO_LINKS: LinkSet = LinkSet::NONE;
static NO_ARTEFACTS: ArtefactSet = ArtefactSet::NONE;
static NO_RUNTIMES: InstalledRuntimes = InstalledRuntimes::NONE;
static DEFAULT_FRAMEWORK_ROUTES: FrameworkRouteCheck = FrameworkRouteCheck::DEFAULT;

impl<'run> GenerateRequest<'run> {
    /// A request for `ir` with no options, needs, links, artefacts or runtimes.
    #[must_use]
    pub fn new(ir: &'run ContractIr) -> Self {
        Self {
            ir,
            options: None,
            needs: &NO_NEEDS,
            links: &NO_LINKS,
            artefacts: &NO_ARTEFACTS,
            framework_routes: None,
            hook_check: None,
            mount: None,
            import_specifiers: None,
            native_docs_document: None,
            installed_runtimes: &NO_RUNTIMES,
        }
    }

    /// With the entry's raw options.
    #[must_use]
    pub const fn with_options(mut self, options: &'run JsonValue) -> Self {
        self.options = Some(options);
        self
    }

    /// With the target's resolved needs.
    #[must_use]
    pub const fn with_needs(mut self, needs: &'run ResolvedLinkNeeds) -> Self {
        self.needs = needs;
        self
    }

    /// With the entry's links.
    #[must_use]
    pub const fn with_links(mut self, links: &'run LinkSet) -> Self {
        self.links = links;
        self
    }

    /// With the switched-on artefacts.
    #[must_use]
    pub const fn with_artefacts(mut self, artefacts: &'run ArtefactSet) -> Self {
        self.artefacts = artefacts;
        self
    }

    /// With the entry's framework-route check.
    #[must_use]
    pub const fn with_framework_routes(mut self, check: &'run FrameworkRouteCheck) -> Self {
        self.framework_routes = Some(check);
        self
    }

    /// With the entry's hook boot check level.
    #[must_use]
    pub const fn with_hook_check(mut self, level: HookBootCheck) -> Self {
        self.hook_check = Some(level);
        self
    }

    /// With the entry's `mount`.
    #[must_use]
    pub const fn with_mount(mut self, mount: &'run str) -> Self {
        self.mount = Some(mount);
        self
    }

    /// With the import style of the linked consumers.
    #[must_use]
    pub const fn with_import_specifiers(mut self, style: ImportSpecifierStyle) -> Self {
        self.import_specifiers = Some(style);
        self
    }

    /// With the document the `nativeDocs` artefact follows.
    #[must_use]
    pub const fn with_native_docs_document(mut self, document: &'run NativeDocsDocument) -> Self {
        self.native_docs_document = Some(document);
        self
    }

    /// With the installed versions of the runtime packages.
    #[must_use]
    pub const fn with_installed_runtimes(mut self, runtimes: &'run InstalledRuntimes) -> Self {
        self.installed_runtimes = runtimes;
        self
    }
}

/// What a family's typed `generate` receives: the request with its defaults applied and its
/// options parsed.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct GenerateInput<'run, Options> {
    /// The api's IR.
    pub ir: &'run ContractIr,
    /// The parsed options.
    pub options: Options,
    /// The target's needs; every non-optional one has its link.
    pub needs: &'run ResolvedLinkNeeds,
    /// The links, each accepted by the link check.
    pub links: &'run LinkSet,
    /// The switched-on artefacts, each declared.
    pub artefacts: &'run ArtefactSet,
    /// The framework-route check.
    pub framework_routes: &'run FrameworkRouteCheck,
    /// The hook boot check level.
    pub hook_check: HookBootCheck,
    /// The mount, empty when the entry writes none.
    pub mount: &'run str,
    /// How relative imports name their modules.
    pub import_specifiers: ImportSpecifierStyle,
    /// The document the `nativeDocs` artefact follows; present exactly when it is on.
    pub native_docs_document: Option<&'run NativeDocsDocument>,
    /// The installed versions of the runtime packages.
    pub installed_runtimes: &'run InstalledRuntimes,
}

/// What a family implements: the typed half of `defineTarget`.
pub trait TargetDefinition: Sync {
    /// The parsed options.
    type Options;

    /// The static metadata.
    fn metadata(&self) -> &TargetMetadata;

    /// Parses the entry's raw options.
    ///
    /// # Errors
    ///
    /// The refusals of options the target does not take.
    fn parse_options(&self, raw: Option<&JsonValue>) -> Result<Self::Options, TargetFailure>;

    /// Writes the files of one api.
    ///
    /// # Errors
    ///
    /// The refusals of forms the target cannot write.
    fn generate(
        &self,
        input: &GenerateInput<'_, Self::Options>,
    ) -> Result<Generated, TargetFailure>;

    /// The descriptors of the kinds the target provides; only a provider overrides it, and the
    /// registry test catches one that forgets.
    ///
    /// # Errors
    ///
    /// The refusals of forms the provider cannot describe.
    fn describe(
        &self,
        _ir: &ContractIr,
        _options: &Self::Options,
    ) -> Result<DescriptorSet, TargetFailure> {
        Ok(DescriptorSet::default())
    }
}

/// What the registry holds and the run planning calls: the erased `Target` of `define-target.ts`.
pub trait Generator: Sync {
    /// The static metadata.
    fn metadata(&self) -> &TargetMetadata;

    /// Checks the IR support, parses the options, checks the links and artefacts, then writes.
    ///
    /// # Errors
    ///
    /// The refusals of the first check that fails, or of the target.
    fn generate(&self, request: &GenerateRequest<'_>) -> Result<Generated, TargetFailure>;

    /// Checks the IR support and describes what a provider writes for `ir` under `options`
    /// (`{}` when the entry has none); empty for a target that provides nothing.
    ///
    /// # Errors
    ///
    /// The refusals of the IR support check, the options or the provider.
    fn describe(
        &self,
        ir: &ContractIr,
        options: &JsonValue,
    ) -> Result<DescriptorSet, TargetFailure>;
}

impl fmt::Debug for dyn Generator + '_ {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("Generator")
            .field(&self.metadata().id.as_str())
            .finish()
    }
}

impl<Definition: TargetDefinition> Generator for Definition {
    fn metadata(&self) -> &TargetMetadata {
        TargetDefinition::metadata(self)
    }

    fn generate(&self, request: &GenerateRequest<'_>) -> Result<Generated, TargetFailure> {
        let metadata = TargetDefinition::metadata(self);
        let ir_refusals = refuse_unsupported_ir(request.ir, metadata);

        if !ir_refusals.is_empty() {
            return Err(Refused(ir_refusals).into());
        }

        let options = self.parse_options(request.options)?;
        let declared_artefacts = refuse_undeclared_artefacts(request.artefacts, metadata.artefacts);

        let mut refusals = refuse_unmet_links(request.needs, request.links);

        refusals.extend(declared_artefacts);

        if !refusals.is_empty() {
            return Err(Refused(refusals).into());
        }

        let input = GenerateInput {
            ir: request.ir,
            options,
            needs: request.needs,
            links: request.links,
            artefacts: request.artefacts,
            framework_routes: request
                .framework_routes
                .unwrap_or(&DEFAULT_FRAMEWORK_ROUTES),
            hook_check: request.hook_check.unwrap_or_default(),
            mount: request.mount.unwrap_or(NO_MOUNT),
            import_specifiers: request
                .import_specifiers
                .or(metadata.import_specifiers)
                .unwrap_or_default(),
            native_docs_document: request.native_docs_document,
            installed_runtimes: request.installed_runtimes,
        };

        TargetDefinition::generate(self, &input)
    }

    fn describe(
        &self,
        ir: &ContractIr,
        options: &JsonValue,
    ) -> Result<DescriptorSet, TargetFailure> {
        let metadata = TargetDefinition::metadata(self);
        let ir_refusals = refuse_unsupported_ir(ir, metadata);

        if !ir_refusals.is_empty() {
            return Err(Refused(ir_refusals).into());
        }

        // A target that provides nothing has no `describe` in the TypeScript: its options are
        // not parsed.
        if metadata.provides.kinds().is_empty() {
            return Ok(DescriptorSet::default());
        }

        let options = self.parse_options(Some(options))?;

        TargetDefinition::describe(self, ir, &options)
    }
}
