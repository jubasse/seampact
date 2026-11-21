//! A monorepo root's merged document (ADR 0004 section 12, ADR 0011): each api's document mapped
//! under the merged document's options, its prefix applied, then written as one.

use indexmap::IndexMap;
use seampact_ir::{ContractIr, DocumentId};
use seampact_target::Refusal;

use crate::not_ported::not_ported_yet;
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
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub fn merge_documents(
    _inputs: &[MergeInput],
    _options: &MergeOptions,
) -> Result<MergeOutcome, OpenApiError> {
    Err(not_ported_yet("mergeDocuments"))
}
