//! A monorepo root's merged document (ADR 0004 section 12, ADR 0011): each api's document mapped
//! under the merged document's options, its prefix applied, then written as one.

use indexmap::IndexMap;
use seampact_ir::{ApiDocument, ContractIr, DocumentId};
use seampact_js::{cmp_utf16, js_key_order};
use seampact_target::{Refusal, without_repeats};

use crate::documents::{
    api_extension_value, build_planned_document, every_surface_selection, unsupported_ir_refusals,
};
use crate::merged_document::{ApiSource, assemble_merged_document, merge_refusal};
use crate::prefix_document::{is_valid_prefix, prefix_document};
use crate::serialize::serialize_document;
use crate::{EmitterOptions, OpenApiError};

/// One api a merged document holds, as an app serves or documents it.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeInput {
    /// The api's IR, holding only the operations the contributing app serves.
    pub ir: ContractIr,
    /// The `api.documents` key the app names; absent for every surface with internal routes kept.
    pub document: Option<DocumentId>,
}

/// The options of a merged document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeOptions {
    /// The merged document's name in the root config, its `info.title`.
    pub name: String,
    /// A prefix per api name for its operation ids and component keys.
    pub prefix: IndexMap<String, String>,
    /// The emitter options of the merged document.
    pub emitter: EmitterOptions,
}

/// The merged document, or the refusals that stop it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    /// The merged document as YAML.
    Merged {
        /// The document text.
        text: String,
    },
    /// Why no document is written, each naming the apis and the fix.
    Refused(Vec<Refusal>),
}

/// The merged document of several apis, or the refusals that stop it.
///
/// # Errors
///
/// [`OpenApiError::Internal`] for a bug.
pub fn merge_documents(
    inputs: &[MergeInput],
    options: &MergeOptions,
) -> Result<MergeOutcome, OpenApiError> {
    if inputs.is_empty() {
        return Ok(refused(vec![Refusal {
            code: "openapi.merge.empty".to_owned(),
            message: format!(
                "The merged document '{}' holds no api: no app it covers serves or documents one.",
                options.name
            ),
            fix: "List in its 'apps' an app with a server target or an OpenAPI-only app, or remove the document.".to_owned(),
            operation: None,
            member: None,
            docs: None,
        }]));
    }

    let mut refusals = prefix_refusals(inputs, options);
    let mut sources = Vec::new();

    for input in inputs {
        match build_input_document(input, options)? {
            BuiltInput::Built(source) => sources.push(source),
            BuiltInput::Refused(input_refusals) => refusals.extend(input_refusals),
        }
    }

    if !refusals.is_empty() {
        return Ok(refused(without_repeats(refusals)));
    }

    let assembled = assemble_merged_document(&sources, options)?;

    if !assembled.refusals.is_empty() {
        return Ok(refused(without_repeats(assembled.refusals)));
    }

    Ok(MergeOutcome::Merged {
        text: serialize_document(&assembled.document)?,
    })
}

fn refused(refusals: Vec<Refusal>) -> MergeOutcome {
    MergeOutcome::Refused(refusals)
}

/// An input's document, or the refusals that stop it.
enum BuiltInput {
    Built(ApiSource),
    Refused(Vec<Refusal>),
}

/// The refusals of the prefixes: one for an api no input gives, one for a prefix that is no key.
fn prefix_refusals(inputs: &[MergeInput], options: &MergeOptions) -> Vec<Refusal> {
    let mut api_names: Vec<&str> = inputs
        .iter()
        .map(|input| input.ir.api.id.as_str())
        .collect();

    api_names.sort_by(|left, right| cmp_utf16(left, right));
    api_names.dedup();

    let mut refusals = Vec::new();

    for (api, prefix) in js_key_order(&options.prefix) {
        if !api_names.contains(&api.as_str()) {
            refusals.push(merge_refusal(
                "openapi.merge.prefix-api",
                format!(
                    "The merged document '{}' sets a prefix for '{api}', an api none of its apps gives.",
                    options.name
                ),
                format!(
                    "Name one of {} in 'prefix', or remove '{api}'.",
                    api_names.join(", ")
                ),
            ));
        }

        if !is_valid_prefix(prefix) {
            refusals.push(merge_refusal(
                "openapi.merge.prefix-invalid",
                format!(
                    "The prefix '{prefix}' of '{api}' is not an OpenAPI component key segment."
                ),
                "Write the prefix with letters, digits, '.', '-' and '_' only, such as 'billing'."
                    .to_owned(),
            ));
        }
    }

    refusals
}

/// The selection an input names: every surface, or the `api.documents` entry it gives.
fn input_selection(input: &MergeInput) -> Option<ApiDocument> {
    match &input.document {
        None => Some(every_surface_selection(&input.ir)),
        Some(document) => input.ir.api.documents.get(document).cloned(),
    }
}

/// The document an input writes, prefixed when the api has a prefix.
///
/// # Errors
///
/// As the writer of the document.
fn build_input_document(
    input: &MergeInput,
    options: &MergeOptions,
) -> Result<BuiltInput, OpenApiError> {
    let ir: &ContractIr = &input.ir;
    let api = ir.api.id.as_str();
    let unsupported = unsupported_ir_refusals(ir);

    if !unsupported.is_empty() {
        return Ok(BuiltInput::Refused(unsupported));
    }

    let Some(selection) = input_selection(input) else {
        return Ok(BuiltInput::Refused(vec![unknown_document_refusal(
            ir,
            input.document.as_ref(),
        )]));
    };
    let built = build_planned_document(ir, &options.emitter, &selection)?;

    if !built.refusals.is_empty() {
        let refusals = built
            .refusals
            .into_iter()
            .map(|refusal| Refusal {
                message: format!("{} (api '{api}')", refusal.message),
                ..refusal
            })
            .collect();

        return Ok(BuiltInput::Refused(refusals));
    }

    let document = match options.prefix.get(api) {
        Some(prefix) => prefix_document(&built.document, prefix),
        None => built.document,
    };

    Ok(BuiltInput::Built(ApiSource {
        api: api.to_owned(),
        api_value: api_extension_value(ir),
        document,
    }))
}

fn unknown_document_refusal(ir: &ContractIr, document: Option<&DocumentId>) -> Refusal {
    let mut names: Vec<&str> = ir.api.documents.keys().map(DocumentId::as_str).collect();

    names.sort_by(|left, right| cmp_utf16(left, right));

    let listed = if names.is_empty() {
        "no document".to_owned()
    } else {
        names.join(", ")
    };

    Refusal {
        member: Some("/api/documents".to_owned()),
        ..merge_refusal(
            "openapi.merge.unknown-document",
            format!(
                "The api '{}' declares no document '{}'.",
                ir.api.id.as_str(),
                document.map_or("", DocumentId::as_str)
            ),
            format!(
                "Name one of {listed} in the app's config, or leave the document out to give every route."
            ),
        )
    }
}
