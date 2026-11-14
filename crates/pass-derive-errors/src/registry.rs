//! The error registry of ADR 0006 section 6 ("Error declarations on the tree", A35): the
//! declarations of the `errors` catalogue (api, base, shared and packs, merged by the loader, which
//! refuses one code in two layers) and of `errors` on every tree node, then each default code no
//! layer or node declares, with origin `core`. A code declared twice with different definitions is
//! refused naming both places; an attachment of a code nobody declares, and that is no default
//! code, is refused naming the code. Authored codes are checked against
//! `conventions.errors.pattern`.

use std::collections::HashMap;

use indexmap::IndexMap;
use regress::Regex;
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    Docs, ErrorCode, ErrorDecl, ErrorHttp, IrMap, Layer, NatureBase, NatureDecl, NatureId, Origin,
    Schema, SchemaId, SchemaRef,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{
    ConventionReading, DerivationRole, PassError, TreeSchemaService, derivation_params_schema_id,
    derivation_roles, pipeline_tree_nodes, pointer_below,
};

use crate::not_ported::not_ported_yet;
use crate::read::{derive_errors_entries, derive_errors_member, derive_errors_string};
use crate::report::{
    DeriveErrorsContext, DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter,
    DeriveErrorsRule,
};

/// A code of the registry with the merged raw tree pointer of its declaration (absent for a core
/// default).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsRegistered {
    pub(crate) declaration: ErrorDecl,
    pub(crate) pointer: Option<String>,
}

/// The api's error registry, in the order the codes were registered.
pub(crate) type DeriveErrorsRegistry = IndexMap<ErrorCode, DeriveErrorsRegistered>;

/// What the registry is built from besides the raw tree.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsRegistrySources<'sources, 'run> {
    pub(crate) context: DeriveErrorsContext<'run>,
    pub(crate) natures: &'sources IndexMap<NatureId, NatureDecl>,
    /// The schemas tree.schemas wrote, which a declaration's params name.
    pub(crate) schemas: &'sources IrMap<SchemaId, Schema>,
    pub(crate) service: &'sources dyn TreeSchemaService,
}

/// One `errors` entry of the catalogue or of a tree node, at its pointer.
#[derive(Debug, Clone)]
pub(crate) struct ErrorSite<'raw> {
    pub(crate) code: &'raw str,
    pub(crate) pointer: String,
    pub(crate) value: &'raw JsonObject,
}

/// The declarations and the attachments of codes the raw tree writes.
struct ErrorSites<'raw> {
    declarations: Vec<ErrorSite<'raw>>,
    attachments: Vec<ErrorSite<'raw>>,
}

/// The nature of a declaration: its base, and the declared nature that maps onto it, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Nature {
    pub(crate) nature: NatureBase,
    pub(crate) nature_name: Option<NatureId>,
}

/// `conventions.errors.pattern`, compiled, with the text it was written as.
struct ErrorPattern {
    regex: Regex,
    written: String,
}

/// An error code a layer or an identity lists, with its pointer.
struct ListedCode<'raw> {
    code: &'raw str,
    pointer: String,
}

const ERROR_PATTERN_POINTER: &str = "/conventions/errors/pattern";

const ERROR_EVERY_POINTER: &str = "/conventions/errors/every";

/// ADR 0002 section 11: an error without `nature` is `unavailable` for these statuses.
const UNAVAILABLE_STATUSES: &[i64] = &[408, 425, 429, 502, 503, 504];

const FIRST_SERVER_STATUS: i64 = 500;

/// The catalogues whose entries list the codes they answer (ADR 0002 section 9).
const LISTING_CATALOGUES: [&str; 4] = ["identities", "rights", "rules", "scopes"];

/// The base nature of a status, for a declaration that writes no `nature` (ADR 0002 section 11).
pub(crate) fn derive_errors_default_nature(status: i64) -> NatureBase {
    if UNAVAILABLE_STATUSES.contains(&status) {
        return NatureBase::Unavailable;
    }

    if status < FIRST_SERVER_STATUS {
        NatureBase::Refused
    } else {
        NatureBase::Failed
    }
}

/// The family of a code without `family`: the code up to its first dot, none without a dot (ADR
/// 0002 section 4).
pub(crate) fn derive_errors_default_family(code: &str) -> Option<&str> {
    match code.split_once('.') {
        Some((family, _)) if !family.is_empty() => Some(family),
        _ => None,
    }
}

fn role_of_default_code(code: &str) -> Option<&'static DerivationRole> {
    derivation_roles()
        .iter()
        .find(|role| role.default_code == code)
}

fn error_sites<'raw>(
    context: DeriveErrorsContext<'raw>,
) -> Result<ErrorSites<'raw>, InternalError> {
    let mut declarations: Vec<ErrorSite<'raw>> =
        derive_errors_entries(context.raw.merged.get("errors"))
            .into_iter()
            .map(|(code, value)| ErrorSite {
                code,
                pointer: pointer_below("/errors", &[code]),
                value,
            })
            .collect();
    let mut attachments = Vec::new();
    let nodes = pipeline_tree_nodes(context.raw)?;

    for (_, node) in nodes.iter() {
        for (code, value) in derive_errors_entries(derive_errors_member(node.settings, "errors")) {
            let site = ErrorSite {
                code,
                pointer: pointer_below(&node.pointer, &["errors", code]),
                value,
            };

            if derive_errors_member(value, "status").is_none() {
                attachments.push(site);
            } else {
                declarations.push(site);
            }
        }
    }

    Ok(ErrorSites {
        declarations,
        attachments,
    })
}

// What a declaration defines: every member but the attachment's `reach` and `for`, key order
// aside.
fn definition_of(_site: &ErrorSite<'_>) -> Result<String, PassError> {
    Err(not_ported_yet("definitionOf"))
}

fn error_pattern(
    context: DeriveErrorsContext<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<ErrorPattern>, InternalError> {
    let Some(ConventionReading {
        value: JsonValue::String(written),
        ..
    }) = context.conventions.get("errors.pattern")?
    else {
        return Ok(None);
    };

    match Regex::with_flags(written, "u") {
        Ok(regex) => Ok(Some(ErrorPattern {
            regex,
            written: written.clone(),
        })),
        Err(error) => {
            reporter.error(DeriveErrorsProblem {
                rule: DeriveErrorsRule::ErrorPattern,
                message: format!(
                    "conventions.errors.pattern {} is no regular expression: {}",
                    quote_text(written),
                    quote_text(&format!(
                        "SyntaxError: Invalid regular expression: /{written}/u: {error}"
                    ))
                ),
                fix: "write a regular expression every error code must match".to_owned(),
                pointer: ERROR_PATTERN_POINTER.to_owned(),
                related: Vec::new(),
            })?;

            Ok(None)
        }
    }
}

fn check_pattern(
    site: &ErrorSite<'_>,
    pattern: Option<&ErrorPattern>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let Some(pattern) = pattern else {
        return Ok(());
    };

    if pattern.regex.find(site.code).is_some() {
        return Ok(());
    }

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::ErrorPattern,
        message: format!(
            "error code {} does not match conventions.errors.pattern {}",
            quote_text(site.code),
            quote_text(&regexp_source(&pattern.written))
        ),
        fix: "rename the code to match the pattern, or change the pattern".to_owned(),
        pointer: site.pointer.clone(),
        related: vec![DeriveErrorsRelated {
            pointer: ERROR_PATTERN_POINTER.to_owned(),
            message: "the pattern is set here".to_owned(),
        }],
    })
}

/// What `RegExp.prototype.source` answers for a pattern written as `written`: `(?:)` for the empty
/// pattern, a `/` outside a class written `\/`, a line terminator written as its escape.
fn regexp_source(written: &str) -> String {
    if written.is_empty() {
        return "(?:)".to_owned();
    }

    let mut source = String::with_capacity(written.len());
    let mut in_class = false;
    let mut escaped = false;

    for character in written.chars() {
        if escaped {
            escaped = false;
            source.push_str(
                &line_terminator_escape(character)
                    .map_or_else(|| format!("\\{character}"), ToOwned::to_owned),
            );

            continue;
        }

        match character {
            '\\' => escaped = true,
            '[' => {
                in_class = true;
                source.push(character);
            }
            ']' => {
                in_class = false;
                source.push(character);
            }
            '/' if !in_class => source.push_str("\\/"),
            other => source
                .push_str(line_terminator_escape(other).unwrap_or(other.encode_utf8(&mut [0; 4]))),
        }
    }

    if escaped {
        source.push('\\');
    }

    source
}

const fn line_terminator_escape(character: char) -> Option<&'static str> {
    match character {
        '\n' => Some("\\n"),
        '\r' => Some("\\r"),
        '\u{2028}' => Some("\\u2028"),
        '\u{2029}' => Some("\\u2029"),
        _ => None,
    }
}

fn nature_of(
    _site: &ErrorSite<'_>,
    _status: i64,
    _natures: &IndexMap<NatureId, NatureDecl>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Nature, PassError> {
    Err(not_ported_yet("natureOf"))
}

// The params schema of a declaration: the schema its written params compile to, or the core params
// schema of a default code that writes none.
fn params_of(
    _site: &ErrorSite<'_>,
    _service: &dyn TreeSchemaService,
) -> Result<Option<SchemaRef>, PassError> {
    Err(not_ported_yet("paramsOf"))
}

fn check_example(
    _site: &ErrorSite<'_>,
    _params: Option<&SchemaRef>,
    _service: &dyn TreeSchemaService,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkExample"))
}

// ADR 0006 section 6: a layer that redeclares a default code may add or change its params and
// docs, never its status or nature; without `nature` it keeps the core one.
fn default_code_nature(
    _site: &ErrorSite<'_>,
    _status: i64,
    _role: &DerivationRole,
    _sources: &DeriveErrorsRegistrySources<'_, '_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Nature, PassError> {
    Err(not_ported_yet("defaultCodeNature"))
}

fn declaration_of(
    _site: &ErrorSite<'_>,
    _sources: &DeriveErrorsRegistrySources<'_, '_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<ErrorDecl, PassError> {
    Err(not_ported_yet("declarationOf"))
}

fn core_declaration_of(role: &DerivationRole) -> Result<ErrorDecl, InternalError> {
    let code = role.default_code;
    let params = if role.data.is_empty() {
        None
    } else {
        Some(derivation_params_schema_id(code)?)
    };

    Ok(ErrorDecl {
        code: ErrorCode::new(code.to_owned()),
        family: derive_errors_default_family(code).map(str::to_owned),
        nature: role.nature.clone(),
        nature_name: None,
        http: ErrorHttp {
            status: i64::from(role.status),
        },
        params,
        example: None,
        title: None,
        docs: Docs {
            summary: None,
            description: None,
        },
        origin: Origin {
            api: None,
            layer: Layer::Core,
            pointer: pointer_below("/errors", &[code]),
        },
        default: Some(role.role.clone()),
        no_store: None,
    })
}

// Every code an identity, right, rule or scope lists in its `errors`, and each identity header
// use's `stale` code, with its pointer.
fn listed_codes(context: DeriveErrorsContext<'_>) -> Vec<ListedCode<'_>> {
    let mut listed = Vec::new();

    for catalogue in LISTING_CATALOGUES {
        for (name, entry) in derive_errors_entries(context.raw.merged.get(catalogue)) {
            let Some(JsonValue::Array(codes)) = derive_errors_member(entry, "errors") else {
                continue;
            };

            for (index, code) in codes.iter().enumerate() {
                if let JsonValue::String(code) = code {
                    listed.push(ListedCode {
                        code,
                        pointer: pointer_below(
                            &format!("/{catalogue}"),
                            &[name, "errors", &index.to_string()],
                        ),
                    });
                }
            }
        }
    }

    for (name, identity) in derive_errors_entries(context.raw.merged.get("identities")) {
        for (header, usage) in derive_errors_entries(derive_errors_member(identity, "headers")) {
            if let Some(stale) = derive_errors_string(usage, "stale") {
                listed.push(ListedCode {
                    code: stale,
                    pointer: pointer_below("/identities", &[name, "headers", header, "stale"]),
                });
            }
        }
    }

    listed
}

fn report_unattached_code(
    code: &str,
    pointer: String,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::ErrorUnknown,
        message: format!(
            "error code {} is attached here, but no layer or node declares it and it is no default code",
            quote_text(code)
        ),
        fix: format!(
            "declare {} with a status in 'errors', or attach a declared code",
            quote_text(code)
        ),
        pointer,
        related: Vec::new(),
    })
}

// An attached code nobody declares: the node attachments and `conventions.errors.every`.
fn check_attachments(
    attachments: &[ErrorSite<'_>],
    registry: &DeriveErrorsRegistry,
    sources: &DeriveErrorsRegistrySources<'_, '_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    // An attachment's `{ example }` shows the params of the code it attaches.
    for site in attachments {
        match registry.get(site.code) {
            None => report_unattached_code(site.code, site.pointer.clone(), reporter)?,
            Some(registered) => check_example(
                site,
                registered.declaration.params.as_ref(),
                sources.service,
                reporter,
            )?,
        }
    }

    for listed in listed_codes(sources.context) {
        if registry.contains_key(listed.code) {
            continue;
        }

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorUnknown,
            message: format!(
                "error code {} is listed here, but no layer or node declares it and it is no default code",
                quote_text(listed.code)
            ),
            fix: format!(
                "declare {} with a status in 'errors', or list a declared code",
                quote_text(listed.code)
            ),
            pointer: listed.pointer,
            related: Vec::new(),
        })?;
    }

    let Some(ConventionReading {
        value: JsonValue::Array(every),
        ..
    }) = sources.context.conventions.get("errors.every")?
    else {
        return Ok(());
    };

    for (index, code) in every.iter().enumerate() {
        if let JsonValue::String(code) = code
            && !registry.contains_key(code.as_str())
        {
            let pointer = pointer_below(ERROR_EVERY_POINTER, &[&index.to_string()]);

            report_unattached_code(code, pointer, reporter)?;
        }
    }

    Ok(())
}

/// The api's error registry, every default code included; each problem reported.
///
/// # Errors
///
/// A [`PassError`] when a declaration cannot be read yet or a pointer has no origin.
pub(crate) fn derive_errors_registry(
    sources: &DeriveErrorsRegistrySources<'_, '_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsRegistry, PassError> {
    let context = sources.context;
    let mut registry = DeriveErrorsRegistry::new();
    let mut first_sites: HashMap<&str, &ErrorSite<'_>> = HashMap::new();
    let pattern = error_pattern(context, reporter)?;
    let ErrorSites {
        declarations,
        attachments,
    } = error_sites(context)?;

    for site in &declarations {
        let Some(first) = first_sites.get(site.code) else {
            check_pattern(site, pattern.as_ref(), reporter)?;
            first_sites.insert(site.code, site);
            registry.insert(
                ErrorCode::new(site.code.to_owned()),
                DeriveErrorsRegistered {
                    declaration: declaration_of(site, sources, reporter)?,
                    pointer: Some(site.pointer.clone()),
                },
            );

            continue;
        };

        if definition_of(first)? == definition_of(site)? {
            continue;
        }

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorRedefined,
            message: format!(
                "error code {} is declared again with a different definition",
                quote_text(site.code)
            ),
            fix: "attach the code with {} or { example } here, or give one of the two declarations another code"
                .to_owned(),
            pointer: site.pointer.clone(),
            related: vec![DeriveErrorsRelated {
                pointer: first.pointer.clone(),
                message: format!("{} is first declared here", quote_text(site.code)),
            }],
        })?;
    }

    for role in derivation_roles() {
        if !registry.contains_key(role.default_code) {
            registry.insert(
                ErrorCode::new(role.default_code.to_owned()),
                DeriveErrorsRegistered {
                    declaration: core_declaration_of(role)?,
                    pointer: None,
                },
            );
        }
    }

    check_attachments(&attachments, &registry, sources, reporter)?;

    Ok(registry)
}
