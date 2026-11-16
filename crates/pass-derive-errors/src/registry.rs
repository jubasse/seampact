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
    Direction, Docs, ErrorCode, ErrorDecl, ErrorHttp, HTTP_STATUS_RANGE, IrMap, KnownTypeUseRef,
    Layer, NatureBase, NatureDecl, NatureId, Origin, Schema, SchemaId, SchemaRef,
};
use seampact_js::regexp_source;
use seampact_json::{JsonObject, JsonValue, canonical_json, js_integer_in_range};
use seampact_pipeline::{
    ConventionReading, DerivationRole, PassError, TreeSchemaService, derivation_params_schema_id,
    derivation_roles, pipeline_tree_nodes, pointer_below,
};

use crate::natures::derive_errors_is_base_nature;
use crate::read::{
    derive_errors_docs, derive_errors_entries, derive_errors_member, derive_errors_origin_of,
    derive_errors_string,
};
use crate::report::{
    DeriveErrorsContext, DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter,
    DeriveErrorsRule,
};
use crate::role_param_fit::derive_errors_ref_use;
use crate::sensitive_params::{
    DeriveErrorsSensitiveSite, DeriveErrorsSensitiveSources, derive_errors_params_no_store,
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

/// The members of an attachment that are no part of a declaration's definition.
const ATTACHMENT_ONLY_MEMBERS: [&str; 2] = ["reach", "for"];

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
fn definition_of(site: &ErrorSite<'_>) -> String {
    let mut definition = JsonObject::new();

    for (key, value) in site.value {
        if !ATTACHMENT_ONLY_MEMBERS.contains(&key.as_str()) {
            definition.insert(key.clone(), value.clone());
        }
    }

    canonical_json(&JsonValue::Object(definition))
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

fn nature_of(
    site: &ErrorSite<'_>,
    status: i64,
    natures: &IndexMap<NatureId, NatureDecl>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Nature, InternalError> {
    let Some(written) = derive_errors_string(site.value, "nature") else {
        return Ok(Nature {
            nature: derive_errors_default_nature(status),
            nature_name: None,
        });
    };

    if let Some(base) = derive_errors_is_base_nature(written) {
        return Ok(Nature {
            nature: base,
            nature_name: None,
        });
    }

    if let Some(declared) = natures.get(written) {
        return Ok(Nature {
            nature: declared.base.clone(),
            nature_name: Some(NatureId::new(written.to_owned())),
        });
    }

    let mut allowed = vec!["refused", "unavailable", "failed"];

    allowed.extend(natures.keys().map(NatureId::as_str));

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::ErrorNature,
        message: format!(
            "error {} has nature {}, which is neither a base nature nor a declared nature; the allowed values are {}",
            quote_text(site.code),
            quote_text(written),
            allowed.join(", ")
        ),
        fix: "use a base nature or declare the nature in 'natures'".to_owned(),
        pointer: pointer_below(&site.pointer, &["nature"]),
        related: Vec::new(),
    })?;

    Ok(Nature {
        nature: derive_errors_default_nature(status),
        nature_name: None,
    })
}

// The params schema of a declaration: the schema its written params compile to, or the core params
// schema of a default code that writes none.
fn params_of(
    site: &ErrorSite<'_>,
    service: &dyn TreeSchemaService,
) -> Result<Option<SchemaRef>, PassError> {
    let pointer = pointer_below(&site.pointer, &["params"]);

    if derive_errors_member(site.value, "params").is_none() {
        return match role_of_default_code(site.code) {
            Some(role) if !role.data.is_empty() => {
                Ok(Some(derivation_params_schema_id(site.code)?))
            }
            _ => Ok(None),
        };
    }

    let Some(params_use) = service.type_use(&pointer, Direction::Output)? else {
        return Err(InternalError::new(format!(
            "tree.schemas answers no type use at {pointer}, the params of '{}'",
            site.code
        ))
        .into());
    };

    // tree.schemas refuses params that are no object schema (`fields-schema`), and no later half
    // runs then.
    match KnownTypeUseRef::try_from(&params_use)? {
        KnownTypeUseRef::Ref(reference) => Ok(Some(reference.schema.clone())),
        _ => Err(InternalError::new(format!(
            "the params at {pointer} compile to a {}, not an object schema",
            params_use.tag()
        ))
        .into()),
    }
}

fn check_example(
    site: &ErrorSite<'_>,
    params: Option<&SchemaRef>,
    service: &dyn TreeSchemaService,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let Some(example) = derive_errors_member(site.value, "example") else {
        return Ok(());
    };
    let pointer = pointer_below(&site.pointer, &["example"]);
    let code = quote_text(site.code);

    let Some(params) = params else {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorExample,
            message: format!("error {code} has an example but no params for it to show"),
            fix: "declare the params, or remove the example".to_owned(),
            pointer,
            related: Vec::new(),
        })?;

        return Ok(());
    };

    // tree.schemas locates each issue at a value the example holds (a missing member at its
    // object).
    for issue in service.check_example(example, &derive_errors_ref_use(params))? {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorExample,
            message: format!(
                "the example of error {code} does not fit its params: {}",
                issue.message
            ),
            fix: "correct the example to fit the params".to_owned(),
            pointer: format!("{pointer}{}", issue.pointer),
            related: Vec::new(),
        })?;
    }

    Ok(())
}

// ADR 0006 section 6: a layer that redeclares a default code may add or change its params and
// docs, never its status or nature; without `nature` it keeps the core one.
fn default_code_nature(
    site: &ErrorSite<'_>,
    status: i64,
    role: &DerivationRole,
    sources: &DeriveErrorsRegistrySources<'_, '_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Nature, InternalError> {
    let code = quote_text(site.code);
    let role_name = &role.role;

    if status != i64::from(role.status) {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorDefault,
            message: format!(
                "default code {code} of role '{role_name}' is redeclared with status {status}, but its status is {}",
                role.status
            ),
            fix: format!(
                "keep status {}, or declare another code and bind role '{role_name}' to it",
                role.status
            ),
            pointer: pointer_below(&site.pointer, &["status"]),
            related: Vec::new(),
        })?;
    }

    if derive_errors_string(site.value, "nature").is_none() {
        return Ok(Nature {
            nature: role.nature.clone(),
            nature_name: None,
        });
    }

    let written = nature_of(site, status, sources.natures, reporter)?;

    if written.nature != role.nature {
        let written_name = written
            .nature_name
            .as_ref()
            .map_or_else(|| written.nature.as_str(), NatureId::as_str);

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::ErrorDefault,
            message: format!(
                "default code {code} of role '{role_name}' is redeclared with nature {}, whose base is not its nature {}",
                quote_text(written_name),
                quote_text(role.nature.as_str())
            ),
            fix: format!(
                "leave nature out, or name a nature on the base {}",
                quote_text(role.nature.as_str())
            ),
            pointer: pointer_below(&site.pointer, &["nature"]),
            related: Vec::new(),
        })?;
    }

    Ok(written)
}

fn declaration_of(
    site: &ErrorSite<'_>,
    sources: &DeriveErrorsRegistrySources<'_, '_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<ErrorDecl, PassError> {
    let context = sources.context;
    let status = declared_status(site)?;
    let family = derive_errors_string(site.value, "family")
        .or_else(|| derive_errors_default_family(site.code));
    let title = derive_errors_string(site.value, "title");
    let example = derive_errors_member(site.value, "example");
    let params = params_of(site, sources.service)?;
    let role = role_of_default_code(site.code);

    check_example(site, params.as_ref(), sources.service, reporter)?;

    let code = ErrorCode::new(site.code.to_owned());
    let no_store = match &params {
        None => false,
        Some(params) => derive_errors_params_no_store(
            &DeriveErrorsSensitiveSite {
                code: &code,
                params,
                pointer: &pointer_below(&site.pointer, &["params"]),
            },
            &DeriveErrorsSensitiveSources {
                context,
                schemas: sources.schemas,
            },
            reporter,
        )?,
    };
    let nature = match role {
        None => nature_of(site, status, sources.natures, reporter)?,
        Some(role) => default_code_nature(site, status, role, sources, reporter)?,
    };

    Ok(ErrorDecl {
        code,
        family: family.map(str::to_owned),
        nature: nature.nature,
        nature_name: nature.nature_name,
        http: ErrorHttp { status },
        params,
        example: example.cloned(),
        title: title.map(str::to_owned),
        docs: derive_errors_docs(site.value),
        origin: derive_errors_origin_of(context, &site.pointer)?,
        default: role.map(|role| role.role.clone()),
        no_store: no_store.then_some(true),
    })
}

fn declared_status(site: &ErrorSite<'_>) -> Result<i64, InternalError> {
    let no_status = || {
        InternalError::new(format!(
            "the declaration at {} has no numeric status",
            site.pointer
        ))
    };
    let Some(JsonValue::Number(status)) = derive_errors_member(site.value, "status") else {
        return Err(no_status());
    };

    js_integer_in_range(status, HTTP_STATUS_RANGE).map_err(|_| no_status())
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

        if definition_of(first) == definition_of(site) {
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

#[cfg(test)]
mod tests {
    use seampact_json::JsonNumber;

    use super::*;

    fn status_of(text: &str) -> Result<i64, InternalError> {
        let number = JsonNumber::from_json_text(text).unwrap();
        let mut declaration = JsonObject::new();

        declaration.insert("status".to_owned(), JsonValue::Number(number));

        declared_status(&ErrorSite {
            code: "x.y",
            pointer: "/errors/x.y".to_owned(),
            value: &declaration,
        })
    }

    #[test]
    fn a_status_is_a_javascript_integer_within_the_http_range() {
        for (text, expected) in [
            ("404", Some(404)),
            ("404.0", Some(404)),
            ("4.04e2", Some(404)),
        ] {
            assert_eq!(status_of(text).ok(), expected, "status {text}");
        }

        for text in ["1e-17", "404.5", "99", "600", "-0", "9007199254740993"] {
            assert!(status_of(text).is_err(), "status {text}");
        }
    }
}
