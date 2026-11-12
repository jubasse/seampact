//! The loader's reporter: what a load diagnostic is made of, how it is located and deduplicated,
//! and the text each load message writes.
//!
//! A diagnostic about a file position that has no node in the merged tree (a file that fails to
//! parse, a second document, a tag, a missing include) is located by a site pointer. The pointer
//! starts with `~load`, which JSON Pointer never produces (`~` is always `~0` or `~1`), so it
//! cannot collide with a pointer into a merged tree. The origin still resolves through the side
//! table.

use std::collections::HashSet;

use seampact_authoring::{ApiLayer, FileLayer, Locations};
use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, InternalError, RelatedLocation, RuleId,
    Severity, diagnostic_location_key,
};
use seampact_json::escape_pointer;
use seampact_span::{Location, SourceFiles, Span};

use crate::{LOAD_MAX_TEXT, LOAD_MAX_WORK};

macro_rules! load_rules {
    ($($variant:ident => $id:literal,)+) => {
        /// A rule of the load stage: its id is `seampact/load/<short id>`.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum LoadRule {
            $(
                #[doc = concat!("`seampact/load/", $id, "`.")]
                $variant,
            )+
        }

        impl LoadRule {
            /// Every rule of the load stage, in the order of the ids.
            pub const ALL: &'static [LoadRule] = &[$(Self::$variant,)+];

            /// The id without the `seampact/load/` prefix.
            #[must_use]
            pub const fn short_id(self) -> &'static str {
                match self {
                    $(Self::$variant => $id,)+
                }
            }

            /// The full rule id.
            #[must_use]
            pub const fn rule_id(self) -> RuleId {
                match self {
                    $(Self::$variant => RuleId::from_static(concat!("seampact/load/", $id)),)+
                }
            }
        }
    };
}

load_rules! {
    ApiNameMismatch => "api-name-mismatch",
    BaseExtends => "base-extends",
    DataNull => "data-null",
    DeclarationTwice => "declaration-twice",
    DirectiveSiblings => "directive-siblings",
    DirectiveValue => "directive-value",
    DuplicateKey => "duplicate-key",
    ExpansionLimit => "expansion-limit",
    ExtendsCycle => "extends-cycle",
    ExtendsShape => "extends-shape",
    FileExtension => "file-extension",
    FileInvalid => "file-invalid",
    FileMissing => "file-missing",
    FileNotMapping => "file-not-mapping",
    FileTooLarge => "file-too-large",
    IncludeCycle => "include-cycle",
    IncludeFragment => "include-fragment",
    IncludeShape => "include-shape",
    IncludeUnderRoutes => "include-under-routes",
    KeyNotScalar => "key-not-scalar",
    NameNotVisible => "name-not-visible",
    PackCycle => "pack-cycle",
    PackManifest => "pack-manifest",
    PackName => "pack-name",
    PackNameClash => "pack-name-clash",
    PackNameMismatch => "pack-name-mismatch",
    PackNotData => "pack-not-data",
    PackNotFound => "pack-not-found",
    PackPackage => "pack-package",
    PackShape => "pack-shape",
    PackVersionMismatch => "pack-version-mismatch",
    PathAbsolute => "path-absolute",
    PathBackslash => "path-backslash",
    PathCase => "path-case",
    PathEmpty => "path-empty",
    PathEscape => "path-escape",
    RefFileShape => "ref-file-shape",
    RefFragment => "ref-fragment",
    RefPointer => "ref-pointer",
    ReservedKey => "reserved-key",
    ScalarType => "scalar-type",
    TooDeep => "too-deep",
    WorkspaceShape => "workspace-shape",
    YamlAmbiguousScalar => "yaml-ambiguous-scalar",
    YamlAnchor => "yaml-anchor",
    YamlBoolean => "yaml-boolean",
    YamlDocument => "yaml-document",
    YamlNumberFormat => "yaml-number-format",
    YamlReservedScalar => "yaml-reserved-scalar",
    YamlSyntax => "yaml-syntax",
    YamlTag => "yaml-tag",
}

/// A message and the fix that goes with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadMessage {
    /// What is wrong.
    pub message: String,
    /// What to do about it.
    pub fix: String,
}

/// The work limit is spent (`seampact/load/expansion-limit`).
#[must_use]
pub fn work_limit_message() -> LoadMessage {
    LoadMessage {
        message: format!(
            "the contract takes more than {LOAD_MAX_WORK} units of work to load (nodes built for each use of a file, $include targets, nodes merged into each api); the load stops here"
        ),
        fix: "look for a file included many times over, through includes of includes, or a large file shared by many apis".to_owned(),
    }
}

/// The text limit is spent (`seampact/load/expansion-limit`).
#[must_use]
pub fn text_limit_message() -> LoadMessage {
    LoadMessage {
        message: format!(
            "the contract holds more than {LOAD_MAX_TEXT} characters of text, counted for each use of a file and each api it reaches; the load stops here"
        ),
        fix: "look for a large text or data file read by many $file or $include sites, or shared by many apis".to_owned(),
    }
}

/// A second position a pending diagnostic points to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelatedSite {
    /// Where it is.
    pub at: Span,
    /// What it is.
    pub message: String,
}

/// A load diagnostic before it is located: the reporter turns each span into an origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingDiagnostic {
    /// The rule that found it.
    pub rule: LoadRule,
    /// What is wrong.
    pub message: String,
    /// What to do about it.
    pub fix: String,
    /// Where it is.
    pub at: Span,
    /// Other positions it involves.
    pub related: Vec<RelatedSite>,
    /// Error unless a rule says otherwise.
    pub severity: Severity,
}

impl PendingDiagnostic {
    /// An error with no related position.
    #[must_use]
    pub fn new(rule: LoadRule, message: String, fix: String, at: Span) -> Self {
        Self {
            rule,
            message,
            fix,
            at,
            related: Vec::new(),
            severity: Severity::Error,
        }
    }

    /// The same diagnostic with its related positions.
    #[must_use]
    pub fn with_related(mut self, related: Vec<RelatedSite>) -> Self {
        self.related = related;

        self
    }

    /// The same diagnostic at another severity.
    #[must_use]
    pub fn with_severity(mut self, severity: Severity) -> Self {
        self.severity = severity;

        self
    }
}

/// The pointer that locates a diagnostic at a file position: `/~load/<file>/<line>/<column>`.
#[must_use]
pub fn load_site_pointer(site: &Location) -> String {
    format!(
        "/~load/{}/{}/{}",
        escape_pointer(&site.file),
        site.line,
        site.column
    )
}

/// The diagnostic layer of a layer read from a file.
#[must_use]
pub fn diagnostic_layer_of(layer: &FileLayer) -> DiagnosticLayer {
    match layer {
        FileLayer::Workspace => DiagnosticLayer::Workspace,
        FileLayer::Api(ApiLayer::Api) => DiagnosticLayer::Api,
        FileLayer::Api(ApiLayer::Shared) => DiagnosticLayer::Shared,
        FileLayer::Api(ApiLayer::Base) => DiagnosticLayer::Base,
        FileLayer::Api(ApiLayer::Pack(name)) => DiagnosticLayer::Pack(name.as_str().to_owned()),
    }
}

/// The diagnostics of one load, their side table and the set that keeps one report per site.
#[derive(Debug)]
pub struct Reporter {
    diagnostics: Vec<Diagnostic>,
    locations: Locations,
    /// Set by the loader before it works on a layer. A file shared by several apis is reported
    /// once: its site pointer locates it the same way for every api.
    pub layer: FileLayer,
    seen: HashSet<String>,
}

impl Default for Reporter {
    fn default() -> Self {
        Self::new()
    }
}

impl Reporter {
    /// A reporter with nothing reported, working on the `api` layer.
    #[must_use]
    pub fn new() -> Self {
        Self {
            diagnostics: Vec::new(),
            locations: Locations::new(),
            layer: FileLayer::Api(ApiLayer::Api),
            seen: HashSet::new(),
        }
    }

    /// The diagnostics in emit order.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// How many diagnostics are reported: the `since` of a later [`relabel`](Self::relabel).
    #[must_use]
    pub fn len(&self) -> usize {
        self.diagnostics.len()
    }

    /// Whether nothing is reported.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.diagnostics.is_empty()
    }

    /// The side table: the span of each origin reported, by its location key.
    #[must_use]
    pub fn locations(&self) -> &Locations {
        &self.locations
    }

    /// The diagnostics in emit order and the side table.
    #[must_use]
    pub fn into_parts(self) -> (Vec<Diagnostic>, Locations) {
        (self.diagnostics, self.locations)
    }

    /// The origin of a diagnostic at `site`, recorded in the side table.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the span is outside its file.
    #[track_caller]
    pub fn origin_at(
        &mut self,
        files: &SourceFiles,
        site: Span,
    ) -> Result<DiagnosticOrigin, InternalError> {
        let Some(location) = files.location(site) else {
            return Err(InternalError::new(format!(
                "a load diagnostic is at a span outside its file (file {})",
                site.file.index()
            )));
        };

        let origin = DiagnosticOrigin {
            layer: diagnostic_layer_of(&self.layer),
            pointer: load_site_pointer(&location),
            api: None,
        };

        self.locations
            .insert(diagnostic_location_key(&origin), site);

        Ok(origin)
    }

    /// Gives the diagnostics reported since `since` under layer `from` the layer `to`, their table
    /// keys with them: for a file whose layer is known only once it is read (an entry file whose
    /// `$include` brings `workspace:` or `api:`). Those keys are used by nothing reported before.
    pub fn relabel(&mut self, since: usize, from: &FileLayer, to: &FileLayer) {
        let from = diagnostic_layer_of(from);
        let to = diagnostic_layer_of(to);
        let Self {
            diagnostics,
            locations,
            ..
        } = self;

        // A `since` past the end leaves nothing to relabel, as a JavaScript `slice` does.
        let Some(reported_since) = diagnostics.get_mut(since..) else {
            return;
        };

        for diagnostic in reported_since {
            moved_origin(locations, &mut diagnostic.origin, &from, &to);

            for related in &mut diagnostic.related {
                moved_origin(locations, &mut related.origin, &from, &to);
            }
        }
    }

    /// Reports `pending` unless the same rule already reported the same message at the same
    /// position.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file.
    #[track_caller]
    pub fn report(
        &mut self,
        files: &SourceFiles,
        pending: PendingDiagnostic,
    ) -> Result<(), InternalError> {
        let Some(location) = files.location(pending.at) else {
            return Err(InternalError::new(format!(
                "a load diagnostic is at a span outside its file (file {})",
                pending.at.file.index()
            )));
        };
        let identity = format!(
            "{}|{}|{}|{}|{}",
            pending.rule.short_id(),
            location.file,
            location.line,
            location.column,
            pending.message
        );

        if !self.seen.insert(identity) {
            return Ok(());
        }

        let origin = self.origin_at(files, pending.at)?;
        let mut related: Vec<RelatedLocation> = Vec::with_capacity(pending.related.len());

        for site in pending.related {
            related.push(RelatedLocation {
                origin: self.origin_at(files, site.at)?,
                message: site.message,
            });
        }

        self.diagnostics.push(Diagnostic {
            severity: pending.severity,
            rule: pending.rule.rule_id(),
            message: pending.message,
            fix: pending.fix,
            origin,
            related,
        });

        Ok(())
    }
}

/// Moves `origin` from layer `from` to `to` and its table entry with it; another layer is kept.
fn moved_origin(
    locations: &mut Locations,
    origin: &mut DiagnosticOrigin,
    from: &DiagnosticLayer,
    to: &DiagnosticLayer,
) {
    if origin.layer != *from {
        return;
    }

    let site = locations.shift_remove(&diagnostic_location_key(origin));

    origin.layer = to.clone();

    if let Some(site) = site {
        locations.insert(diagnostic_location_key(origin), site);
    }
}
