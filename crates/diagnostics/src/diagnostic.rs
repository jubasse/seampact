use std::borrow::Cow;
use std::fmt;

/// How bad a diagnostic is: an error refuses the contract, a warning does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Severity {
    /// The contract is refused.
    Error,
    /// The contract compiles; the author should look.
    Warning,
}

impl Severity {
    /// The text the printer and `diagnostics.json` use.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A rule id, `seampact/<stage>/<rule>` for the compiler's own rules.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RuleId(Cow<'static, str>);

impl RuleId {
    /// A rule id a stage declares as a constant.
    #[must_use]
    pub const fn from_static(id: &'static str) -> Self {
        Self(Cow::Borrowed(id))
    }

    /// A rule id built at run time: the load stage's prefixed ids, a lint plugin's.
    #[must_use]
    pub fn new(id: String) -> Self {
        Self(Cow::Owned(id))
    }

    /// The id text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RuleId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// The layer of a diagnostic's origin: any layer but `core`, which has no file and no side
/// table entry, so a diagnostic about a core declaration is located where it is used.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DiagnosticLayer {
    /// The api file and what it includes.
    Api,
    /// The workspace's shared layer.
    Shared,
    /// A base the api extends.
    Base,
    /// The workspace file.
    Workspace,
    /// A pack, by the name the contract gives it (any text).
    Pack(String),
}

impl fmt::Display for DiagnosticLayer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Api => formatter.write_str("api"),
            Self::Shared => formatter.write_str("shared"),
            Self::Base => formatter.write_str("base"),
            Self::Workspace => formatter.write_str("workspace"),
            Self::Pack(name) => write!(formatter, "pack:{name}"),
        }
    }
}

/// Where a diagnostic is located: a layer and a pointer, found in the side table by
/// [`diagnostic_location_key`](crate::diagnostic_location_key).
///
/// Fields are in the member order of `diagnostics.json`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DiagnosticOrigin {
    /// The layer the pointer belongs to.
    pub layer: DiagnosticLayer,
    /// A JSON pointer into the layer's tree, or a load site pointer.
    pub pointer: String,
    /// The api of an origin copied from another api; the location key ignores it.
    pub api: Option<String>,
}

/// A second position a diagnostic points to, with what it is.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RelatedLocation {
    /// Where it is.
    pub origin: DiagnosticOrigin,
    /// What it is, printed as a sentence after the position.
    pub message: String,
}

/// One problem reported to the author (ADR 0006 section 4).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Diagnostic {
    /// Error or warning.
    pub severity: Severity,
    /// The rule that found it.
    pub rule: RuleId,
    /// What is wrong.
    pub message: String,
    /// What to do about it.
    pub fix: String,
    /// Where it is.
    pub origin: DiagnosticOrigin,
    /// Other positions it involves.
    pub related: Vec<RelatedLocation>,
}

const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}

    assert_send_sync::<Diagnostic>();
};
