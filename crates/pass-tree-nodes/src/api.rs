//! The `api` member: the api file's settings, its surfaces with their resolved prefixes and the path version.

use indexmap::IndexMap;
use seampact_diagnostics::{DiagnosticOrigin, InternalError};
use seampact_ir::{
    ApiCaller, ApiDocument, ApiKind, ApiRole, Compat, CompatPolicy, Docs, DocumentId, IdentityId,
    InternalPolicy, IrMap, KnownApiVersion, LabelApiVersion, Maturity, Name, NameRole, Origin,
    PathApiVersion, PathVersion, PathVersionMode, RightId, Surface, SurfaceId,
};
use seampact_js::{FiniteNumber, js_key_order};
use seampact_json::{JsonValue, stringify_json};
use seampact_naming::split_name;
use seampact_pass_tree_shared::{TREE_NODES_MATURITIES, tree_nodes_member};
use seampact_pipeline::{ApiDeclaration, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_warning,
};
use crate::lifecycle::tree_nodes_own_extensions;
use crate::params::placeholders_of;
use crate::pass::TreeNodesScope;

/// The placeholder a surface prefix holds for the api version.
const VERSION_PLACEHOLDER: &str = "{version}";
/// The prefix a surface gets when its path version is `prefix` and it writes none.
const DEFAULT_VERSIONED_PREFIX: &str = "/v{version}";
const API_KINDS: &[ApiKind] = &[ApiKind::Product, ApiKind::Service];
const DEFAULT_API_KIND: ApiKind = ApiKind::Product;
/// The grammar gives `api.maturity` no default and the IR needs one: an api that states none
/// promises the least.
const DEFAULT_MATURITY: Maturity = Maturity::Experimental;
const COMPAT_POLICIES: &[CompatPolicy] = &[CompatPolicy::AdditiveOnly, CompatPolicy::None];
const DEFAULT_COMPAT: CompatPolicy = CompatPolicy::None;
const PATH_VERSION_MODES: &[PathVersionMode] = &[PathVersionMode::Prefix, PathVersionMode::None];
const INTERNAL_POLICIES: &[InternalPolicy] = &[InternalPolicy::Include, InternalPolicy::Exclude];
const DEFAULT_INTERNAL: InternalPolicy = InternalPolicy::Include;
const API_ROLES: &[ApiRole] = &[ApiRole::Gateway];

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
    version: KnownApiVersion,
    prefix_origin: Origin,
}

/// The name the api and its surfaces take: the role the after-tree fixture writes.
fn schema_name(written: &str) -> Name {
    Name {
        segments: split_name(written),
        role: NameRole::Schema,
        status: None,
    }
}

/// The first of `allowed` that `value` writes, `None` for anything but one of their texts.
pub(crate) fn one_of<T: Clone>(
    value: Option<&JsonValue>,
    allowed: &[T],
    text_of_candidate: fn(&T) -> &str,
) -> Option<T> {
    let text = text_of(value)?;

    allowed
        .iter()
        .find(|candidate| text_of_candidate(candidate) == text)
        .cloned()
}

/// A written string, `None` for any other value.
pub(crate) fn text_of(value: Option<&JsonValue>) -> Option<&str> {
    match value {
        Some(JsonValue::String(text)) => Some(text),
        _ => None,
    }
}

pub(crate) fn tree_nodes_api(
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesSurfacePrefixes, InternalError> {
    let raw = scope.context.raw;
    let written = raw.merged.get("api");
    let origin = required_origin("/api", scope)?;
    let version_origin = scope
        .context
        .origin("/api/version")
        .unwrap_or_else(|| origin.clone());
    let version = version_of(tree_nodes_member(written, "version"))?;

    let surfaces = surfaces_of(&version, &version_origin, scope)?;
    let role = one_of(
        tree_nodes_member(written, "role"),
        API_ROLES,
        ApiRole::as_str,
    );
    let caller = caller_of(tree_nodes_member(written, "caller"));
    let id = text_of(tree_nodes_member(written, "name")).unwrap_or(&raw.name);
    let surface_ids: Vec<String> = surfaces.iter().map(|entry| entry.id.clone()).collect();
    let prefixes: TreeNodesSurfacePrefixes = surfaces
        .iter()
        .map(|entry| (entry.id.clone(), entry.surface.prefix.clone()))
        .collect();

    let api = ApiDeclaration {
        id: id.to_owned(),
        name: schema_name(id),
        version: version.into(),
        kind: one_of(
            tree_nodes_member(written, "kind"),
            API_KINDS,
            ApiKind::as_str,
        )
        .unwrap_or(DEFAULT_API_KIND),
        path_version: path_version_of(&version_origin, scope)?,
        role,
        maturity: one_of(
            tree_nodes_member(written, "maturity"),
            &TREE_NODES_MATURITIES,
            Maturity::as_str,
        )
        .unwrap_or(DEFAULT_MATURITY),
        caller,
        compat: Compat {
            policy: one_of(
                tree_nodes_member(tree_nodes_member(written, "compat"), "policy"),
                COMPAT_POLICIES,
                CompatPolicy::as_str,
            )
            .unwrap_or(DEFAULT_COMPAT),
        },
        surfaces: surfaces
            .into_iter()
            .map(|entry| (SurfaceId::new(entry.id), entry.surface))
            .collect(),
        documents: documents_of(tree_nodes_member(written, "documents"), &surface_ids),
        docs: tree_nodes_docs(written),
        extensions: tree_nodes_own_extensions(written),
        origin,
    };

    scope.output.api = Some(api);

    Ok(prefixes)
}

fn required_origin(
    pointer: &str,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Origin, InternalError> {
    scope
        .context
        .origin(pointer)
        .ok_or_else(|| InternalError::new(format!("the raw tree has no origin for {pointer}")))
}

// An integer version is the path version; a string one a label, allowed only with every surface unversioned.
fn version_of(written: Option<&JsonValue>) -> Result<KnownApiVersion, InternalError> {
    match written {
        Some(JsonValue::Number(number)) => Ok(KnownApiVersion::Path(PathApiVersion {
            number: integer_of(number.to_f64())?,
        })),
        Some(JsonValue::String(label)) => Ok(KnownApiVersion::Label(LabelApiVersion {
            label: label.clone(),
        })),
        _ => Err(InternalError::new(
            "the api file has no version, which the grammar requires",
        )),
    }
}

// The grammar admits an integer version only.
fn integer_of(number: f64) -> Result<i64, InternalError> {
    let text = FiniteNumber::new(number).map(|finite| finite.to_string());

    text.as_deref()
        .and_then(|text| text.parse::<i64>().ok())
        .ok_or_else(|| InternalError::new(format!("the api version {number} is no integer")))
}

fn path_version_of(
    version_origin: &Origin,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<PathVersion, InternalError> {
    let reading = scope.context.conventions.get("pathVersion")?;
    let value = one_of(
        reading.as_ref().map(|reading| reading.value),
        PATH_VERSION_MODES,
        PathVersionMode::as_str,
    );
    let Some(value) = value else {
        let resolved = reading.as_ref().map_or_else(
            || "undefined".to_owned(),
            |reading| stringify_json(reading.value),
        );

        return Err(InternalError::new(format!(
            "conventions.pathVersion resolves to {resolved}, no mode the grammar admits"
        )));
    };
    let origin = reading
        .and_then(|reading| reading.origin)
        .unwrap_or_else(|| version_origin.clone());

    Ok(PathVersion { value, origin })
}

/// The `summary` and `description` written on a mapping.
pub(crate) fn tree_nodes_docs(written: Option<&JsonValue>) -> Docs {
    Docs {
        summary: text_of(tree_nodes_member(written, "summary")).map(str::to_owned),
        description: text_of(tree_nodes_member(written, "description")).map(str::to_owned),
    }
}

fn caller_of(written: Option<&JsonValue>) -> Option<ApiCaller> {
    let identity = text_of(tree_nodes_member(written, "identity"))?;
    let right = text_of(tree_nodes_member(written, "right"))?;

    Some(ApiCaller {
        identity: IdentityId::new(identity.to_owned()),
        right: RightId::new(right.to_owned()),
    })
}

fn documents_of(
    written: Option<&JsonValue>,
    surface_ids: &[String],
) -> IrMap<DocumentId, ApiDocument> {
    let mut documents = IrMap::new();

    let Some(JsonValue::Object(declared)) = written else {
        return documents;
    };

    for (id, document) in js_key_order(declared.iter()) {
        let surfaces: Vec<SurfaceId> = match tree_nodes_member(Some(document), "surfaces") {
            Some(JsonValue::Array(listed)) => listed
                .iter()
                .filter_map(|surface| text_of(Some(surface)))
                .map(|surface| SurfaceId::new(surface.to_owned()))
                .collect(),
            _ => surface_ids.iter().cloned().map(SurfaceId::new).collect(),
        };
        let internal = one_of(
            tree_nodes_member(Some(document), "internal"),
            INTERNAL_POLICIES,
            InternalPolicy::as_str,
        )
        .unwrap_or(DEFAULT_INTERNAL);

        documents.insert(
            DocumentId::new(id.clone()),
            ApiDocument { surfaces, internal },
        );
    }

    documents
}

fn surfaces_of(
    version: &KnownApiVersion,
    version_origin: &Origin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<SurfaceEntry>, InternalError> {
    let raw = scope.context.raw;
    let Some(JsonValue::Object(written)) = raw.merged.get("surfaces") else {
        return Ok(Vec::new());
    };

    let convention_mode = scope.context.conventions.get("pathVersion")?;
    let mut entries = Vec::new();
    let mut versioned_surfaces: Vec<&str> = Vec::new();

    for (id, settings) in js_key_order(written.iter()) {
        let pointer = pointer_below("/surfaces", &[id]);
        let origin = required_origin(&pointer, scope)?;
        let mode = one_of(
            tree_nodes_member(Some(settings), "pathVersion"),
            PATH_VERSION_MODES,
            PathVersionMode::as_str,
        )
        .or_else(|| {
            one_of(
                convention_mode.as_ref().map(|reading| reading.value),
                PATH_VERSION_MODES,
                PathVersionMode::as_str,
            )
        })
        .ok_or_else(|| {
            InternalError::new(format!("the surface {id} resolves no path version mode"))
        })?;

        let prefix_text = text_of(tree_nodes_member(Some(settings), "prefix"));
        let written_prefix = prefix_text.unwrap_or("");
        let prefix_origin = scope
            .context
            .origin(&format!("{pointer}/prefix"))
            .unwrap_or_else(|| origin.clone());

        check_prefix(
            &PrefixSite {
                id: id.clone(),
                written_prefix: written_prefix.to_owned(),
                written_empty: prefix_text == Some(""),
                mode: mode.clone(),
                version: version.clone(),
                prefix_origin,
            },
            scope,
        )?;

        if mode == PathVersionMode::Prefix {
            versioned_surfaces.push(id);
        }

        entries.push(SurfaceEntry {
            id: id.clone(),
            surface: Surface {
                name: schema_name(id),
                prefix: resolve_prefix(written_prefix, &mode, version),
                path_version: mode,
                origin,
            },
        });
    }

    if let KnownApiVersion::Label(label) = version
        && !versioned_surfaces.is_empty()
    {
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::ApiVersion,
            origin: tree_nodes_node_origin(version_origin)?,
            message: format!(
                "The api version {} is a label, but the surface {} puts a version number in its paths.",
                label.label,
                versioned_surfaces.join(", ")
            ),
            fix: "Write an integer version, or set pathVersion: none on every surface (or in conventions).".to_owned(),
            related: Vec::new(),
        });

        scope.context.report(diagnostic);
    }

    Ok(entries)
}

// `{version}` under `pathVersion: none`, and a literal version segment under `prefix`, are refused (FR-2, SCN-032).
// Under `none` the prefix is used exactly as written, so a third party's `/v1` stays.
fn check_prefix(
    site: &PrefixSite,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let origin = tree_nodes_node_origin(&site.prefix_origin)?;

    check_prefix_placeholders(site, &origin, scope);

    if site.written_empty && site.mode == PathVersionMode::Prefix {
        scope.context.report(tree_nodes_warning(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PathVersion,
            origin: origin.clone(),
            message: format!(
                "The prefix of the surface {} is empty, but its paths still start with /v{{version}}.",
                site.id
            ),
            fix: "Set pathVersion: none on the surface to keep its paths as written, or write the prefix you want.".to_owned(),
            related: Vec::new(),
        }));
    }

    if site.mode == PathVersionMode::None {
        if site.written_prefix.contains(VERSION_PLACEHOLDER) {
            scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::PathVersion,
                origin,
                message: format!(
                    "The prefix {} of the surface {} holds {{version}}, but its pathVersion is none.",
                    site.written_prefix, site.id
                ),
                fix: "Remove {version} from the prefix, or set pathVersion: prefix.".to_owned(),
                related: Vec::new(),
            }));
        }

        return Ok(());
    }

    let Some(literal) = site
        .written_prefix
        .split('/')
        .find(|segment| is_literal_version_segment(segment))
    else {
        return Ok(());
    };

    let mismatch = match &site.version {
        KnownApiVersion::Path(path) if Some(path.number.to_string()) != literal_number(literal) => {
            format!(", which differs from the api version {}", path.number)
        }
        _ => String::new(),
    };

    scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::PathVersion,
        origin,
        message: format!(
            "The prefix {} of the surface {} holds the literal version segment {literal}{mismatch}; the version is held once, on the api.",
            site.written_prefix, site.id
        ),
        fix: format!("Write {{version}} instead of {literal}."),
        related: Vec::new(),
    }));

    Ok(())
}

/// A segment that is `v` and digits: the TypeScript's `/^v[0-9]+$/`.
pub(crate) fn is_literal_version_segment(segment: &str) -> bool {
    segment.strip_prefix('v').is_some_and(|digits| {
        !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

// `Number(literal.slice(1))` as text: leading zeros drop, and a digit run past the exact integers rounds.
pub(crate) fn literal_number(literal: &str) -> Option<String> {
    let digits = literal.strip_prefix('v')?;
    let number = digits.parse::<f64>().ok()?;

    FiniteNumber::new(number).map(|finite| finite.to_string())
}

// A prefix's only placeholder is `{version}`: no parameter fills any other, so it would reach the client as written.
fn check_prefix_placeholders(
    site: &PrefixSite,
    origin: &DiagnosticOrigin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    let mut others: Vec<String> = Vec::new();

    for name in placeholders_of(&site.written_prefix) {
        let placeholder = format!("{{{name}}}");

        if placeholder != VERSION_PLACEHOLDER && !others.contains(&placeholder) {
            others.push(placeholder);
        }
    }

    for placeholder in others {
        scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PathParam,
            origin: origin.clone(),
            message: format!(
                "The prefix {} of the surface {} holds {placeholder}, which no parameter fills; a prefix holds only {{version}}.",
                site.written_prefix, site.id
            ),
            fix: format!("Remove {placeholder} from the prefix, or move it into a node's path and declare it in pathParams."),
            related: Vec::new(),
        }));
    }
}

pub(crate) fn resolve_prefix(
    written_prefix: &str,
    mode: &PathVersionMode,
    version: &KnownApiVersion,
) -> String {
    if *mode == PathVersionMode::None {
        return leading_slash(trim_trailing_slash(written_prefix));
    }

    let template = if written_prefix.contains(VERSION_PLACEHOLDER) {
        leading_slash(written_prefix)
    } else {
        format!(
            "{DEFAULT_VERSIONED_PREFIX}{}",
            leading_slash(written_prefix)
        )
    };
    let version_text = match version {
        KnownApiVersion::Path(path) => path.number.to_string(),
        KnownApiVersion::Label(label) => label.label.clone(),
    };

    trim_trailing_slash(&template.replace(VERSION_PLACEHOLDER, &version_text)).to_owned()
}

pub(crate) fn leading_slash(path: &str) -> String {
    if path.is_empty() || path.starts_with('/') {
        return path.to_owned();
    }

    format!("/{path}")
}

pub(crate) fn trim_trailing_slash(path: &str) -> &str {
    path.strip_suffix('/').unwrap_or(path)
}
