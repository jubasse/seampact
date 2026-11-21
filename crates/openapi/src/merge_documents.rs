//! A monorepo root's merged document (ADR 0004 section 12, ADR 0011): each api's document mapped
//! under the merged document's options, its prefix applied, then written as one.

use indexmap::IndexMap;
use seampact_ir::{ContractIr, DocumentId};
use seampact_json::JsonObject;
use seampact_target::{Refusal, without_repeats};

use crate::not_ported::not_ported_yet;
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

    let mut refusals = prefix_refusals(inputs, options)?;
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

/// An api's document, ready to be placed in the merged one.
struct ApiSource;

/// An input's document, or the refusals that stop it.
enum BuiltInput {
    Built(ApiSource),
    Refused(Vec<Refusal>),
}

/// The merged document and the refusals met while assembling it.
struct AssembledDocument {
    document: JsonObject,
    refusals: Vec<Refusal>,
}

fn prefix_refusals(
    _inputs: &[MergeInput],
    _options: &MergeOptions,
) -> Result<Vec<Refusal>, OpenApiError> {
    Err(not_ported_yet("prefixRefusals"))
}

fn build_input_document(
    _input: &MergeInput,
    _options: &MergeOptions,
) -> Result<BuiltInput, OpenApiError> {
    Err(not_ported_yet("buildInputDocument"))
}

fn assemble_merged_document(
    _sources: &[ApiSource],
    _options: &MergeOptions,
) -> Result<AssembledDocument, OpenApiError> {
    Err(not_ported_yet("assembleMergedDocument"))
}
