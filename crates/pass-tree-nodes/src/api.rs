//! The `api` member: the api file's settings, its surfaces with their resolved prefixes and the path version.

use indexmap::IndexMap;
use seampact_diagnostics::DiagnosticOrigin;
use seampact_ir::{
    ApiCaller, ApiDocument, ApiKind, ApiRole, ApiVersion, CompatPolicy, Docs, InternalPolicy,
    Maturity, Origin, PathVersion, PathVersionMode, Surface,
};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The placeholder a surface prefix holds for the api version.
const VERSION_PLACEHOLDER: &str = "{version}";
/// The prefix a surface gets when its path version is `prefix` and it writes none.
const DEFAULT_VERSIONED_PREFIX: &str = "/v{version}";
const API_KINDS: &[ApiKind] = &[ApiKind::Product, ApiKind::Service];
const DEFAULT_API_KIND: ApiKind = ApiKind::Product;
const DEFAULT_MATURITY: Maturity = Maturity::Experimental;
const COMPAT_POLICIES: &[CompatPolicy] = &[CompatPolicy::AdditiveOnly, CompatPolicy::None];
const DEFAULT_COMPAT: CompatPolicy = CompatPolicy::None;
const PATH_VERSION_MODES: &[PathVersionMode] = &[PathVersionMode::Prefix, PathVersionMode::None];
const INTERNAL_POLICIES: &[InternalPolicy] = &[InternalPolicy::Include, InternalPolicy::Exclude];
const DEFAULT_INTERNAL: InternalPolicy = InternalPolicy::Include;
const API_ROLES: &[ApiRole] = &[ApiRole::Gateway];
/// The name role the api and its surfaces take.
const NAME_ROLE: &str = "schema";

/// The resolved prefix of each surface, by surface name.
pub(crate) type TreeNodesSurfacePrefixes = IndexMap<String, String>;

/// A surface of the api with the id it is declared under.
#[derive(Debug, Clone, PartialEq)]
struct SurfaceEntry {
    id: String,
    surface: Surface,
}

/// Where a surface prefix is written and what it must hold.
#[derive(Debug, Clone, PartialEq)]
struct PrefixSite {
    id: String,
    written_prefix: String,
    /// The prefix is written, and empty (a missing prefix is not).
    written_empty: bool,
    mode: PathVersionMode,
    version: ApiVersion,
    prefix_origin: Origin,
}

fn one_of<T: Copy + AsRef<str>>(
    _value: Option<&JsonValue>,
    _allowed: &[T],
) -> Result<Option<T>, PassError> {
    Err(not_ported_yet("oneOf"))
}

fn text_of(_value: Option<&JsonValue>) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("textOf"))
}

pub(crate) fn tree_nodes_api(
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesSurfacePrefixes, PassError> {
    Err(not_ported_yet("treeNodesApi"))
}

fn required_origin(
    _pointer: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("requiredOrigin"))
}

fn version_of(_written: Option<&JsonValue>) -> Result<ApiVersion, PassError> {
    Err(not_ported_yet("versionOf"))
}

fn path_version_of(
    _version_origin: &Origin,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<PathVersion, PassError> {
    Err(not_ported_yet("pathVersionOf"))
}

pub(crate) fn tree_nodes_docs(_written: Option<&JsonValue>) -> Result<Docs, PassError> {
    Err(not_ported_yet("treeNodesDocs"))
}

fn caller_of(_written: Option<&JsonValue>) -> Result<Option<ApiCaller>, PassError> {
    Err(not_ported_yet("callerOf"))
}

fn documents_of(
    _written: Option<&JsonValue>,
    _surface_ids: &[String],
) -> Result<IndexMap<String, ApiDocument>, PassError> {
    Err(not_ported_yet("documentsOf"))
}

fn surfaces_of(
    _version: &ApiVersion,
    _version_origin: &Origin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<SurfaceEntry>, PassError> {
    Err(not_ported_yet("surfacesOf"))
}

fn check_prefix(
    _site: &PrefixSite,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkPrefix"))
}

fn check_prefix_placeholders(
    _site: &PrefixSite,
    _origin: &DiagnosticOrigin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkPrefixPlaceholders"))
}

fn resolve_prefix(
    _written_prefix: &str,
    _mode: &PathVersionMode,
    _version: &ApiVersion,
) -> Result<String, PassError> {
    Err(not_ported_yet("resolvePrefix"))
}

fn leading_slash(_path: &str) -> Result<String, PassError> {
    Err(not_ported_yet("leadingSlash"))
}

fn trim_trailing_slash(_path: &str) -> Result<String, PassError> {
    Err(not_ported_yet("trimTrailingSlash"))
}
