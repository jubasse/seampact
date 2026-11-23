//! The files of every entry of an app, generated in memory in link order.

use std::collections::HashMap;

use seampact_cli_config::{
    CliProblem, PlannedAppDocument, Problems, TargetEntrySettings, entry_where, located_problem,
};
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use seampact_target::{
    DescriptorSet, GENERATE_TROUBLESHOOTING_URL, ImportSpecifierStyle, LINK_TROUBLESHOOTING_URL,
    LinkSet, Refusal, TargetFailure,
};

use crate::contract_position::ContractPositions;
use crate::drift_level::DEFAULT_DRIFT_CHECK_LEVEL;
use crate::entry_links::{links_of, paired_api};
use crate::exclusive_base_paths::exclusive_base_path_problems;
use crate::generated_output::GeneratedApi;
use crate::import_specifier_styles::import_specifier_styles;
use crate::link_set::{add_link, is_link_kind, relative_location};
use crate::not_ported::not_ported_yet;
use crate::planned_entry::{PlannedApi, PlannedEntry};
use crate::refusal_problem::problem_from_refusal;
use crate::stop::{Stop, gather};
use crate::{AppPlan, GeneratedOutput};

const LINK_CODE_PREFIX: &str = "link.";

/// What describing a provider's api answers.
type DescribeOutcome = Result<DescriptorSet, TargetFailure>;

/// What a run keeps while it generates the entries of an app.
pub(crate) struct EntryGeneration<'plan> {
    /// Every planned entry.
    pub(crate) entries: &'plan [PlannedEntry],
    /// The describe answers already known.
    pub(crate) describe: Describe,
    /// The documents the app writes.
    #[expect(dead_code, reason = "read by generate_api, brief 2")]
    pub(crate) app_documents: Vec<&'plan PlannedAppDocument>,
    /// The warning codes the config ignores.
    #[expect(dead_code, reason = "read by generate_api, brief 2")]
    pub(crate) ignored_warnings: &'plan [String],
}

/// Each provider's `describe` answer, kept by entry, source and api so it runs once.
#[derive(Default)]
pub(crate) struct Describe {
    described: HashMap<(String, String, String), DescribeOutcome>,
}

/// An empty cache of `describe` answers.
pub(crate) fn memoized_describe() -> Describe {
    Describe::default()
}

impl Describe {
    /// What `provider` describes for `provider_api`, run the first time it is asked.
    pub(crate) fn of(
        &mut self,
        provider: &PlannedEntry,
        provider_api: &PlannedApi,
    ) -> &DescribeOutcome {
        let key = (
            provider.settings.id.clone(),
            provider_api.source.clone(),
            provider_api.api.clone(),
        );

        self.described.entry(key).or_insert_with(|| {
            let options = provider
                .settings
                .options
                .clone()
                .unwrap_or_else(|| JsonValue::object([]));

            provider.target.describe(&provider_api.ir, &options)
        })
    }
}

/// Generates the files of every entry and api of `plan`, in link order; `app` names the app of a
/// root run.
///
/// # Errors
///
/// [`Stop::Refused`] with the problems of every api the targets refuse; [`Stop::Failed`] with
/// [`GenerateError::NotPortedYet`](crate::GenerateError::NotPortedYet) until `generateApi` is
/// ported, or for a bug.
pub fn generate_entries(
    plan: &AppPlan<'_>,
    app: Option<&str>,
) -> Result<Vec<GeneratedOutput>, Stop> {
    let level = plan
        .config
        .checks
        .generated
        .unwrap_or(DEFAULT_DRIFT_CHECK_LEVEL);
    let styles = import_specifier_styles(&plan.entries)?;
    let entries: Vec<&PlannedEntry> = plan.entries.iter().collect();

    exclusive_base_path_problems(&entries)?;

    let mut generation = EntryGeneration {
        entries: &plan.entries,
        describe: memoized_describe(),
        app_documents: plan.documents.iter().map(|each| &each.planned).collect(),
        ignored_warnings: &plan.config.warnings.ignore,
    };
    let mut outputs = Vec::new();
    let mut problems = Vec::new();

    for consumer in &plan.entries {
        let style = styles.get(consumer.settings.id.as_str()).copied();

        for planned_api in &consumer.apis {
            let step = generate_api(consumer, planned_api, style, &mut generation);

            if let Some(generated) = gather(step, &mut problems)? {
                outputs.push(generated.into_output(level, app));
            }
        }
    }

    Problems::refuse_any(problems)?;

    Ok(outputs)
}

fn generate_api(
    _consumer: &PlannedEntry,
    _planned_api: &PlannedApi,
    _style: Option<ImportSpecifierStyle>,
    _generation: &mut EntryGeneration<'_>,
) -> Result<GeneratedApi, Stop> {
    Err(not_ported_yet("generateApi").into())
}

/// `refusal` with the troubleshooting section of its code when it names none.
#[expect(
    dead_code,
    reason = "called by build_links until generate_api is ported, brief 2"
)]
fn with_docs(refusal: &Refusal) -> Refusal {
    if refusal.docs.is_some() {
        return refusal.clone();
    }

    let docs = if refusal.code.starts_with(LINK_CODE_PREFIX) {
        LINK_TROUBLESHOOTING_URL
    } else {
        GENERATE_TROUBLESHOOTING_URL
    };

    Refusal {
        docs: Some(docs.to_owned()),
        ..refusal.clone()
    }
}

/// Where a refusal of `code` is: the providers a link refusal names, else the entry and api.
#[expect(dead_code, reason = "called by generate_api, brief 2")]
fn refusal_where(entry: &TargetEntrySettings, api: &str, code: &str) -> String {
    let provider_ids: Vec<String> = links_of(entry)
        .into_iter()
        .map(|(_, provider_id)| format!("'{provider_id}'"))
        .collect();

    if code.starts_with(LINK_CODE_PREFIX) && !provider_ids.is_empty() {
        return format!(
            "entry '{}' linked to {}, api '{api}'",
            entry.id,
            provider_ids.join(", ")
        );
    }

    entry_where(&entry.id, Some(api))
}

/// The links `consumer_api` receives from the providers its entry names.
#[expect(dead_code, reason = "called by generate_api, brief 2")]
fn build_links(
    consumer: &PlannedEntry,
    consumer_api: &PlannedApi,
    generation: &mut EntryGeneration<'_>,
) -> Result<LinkSet, Stop> {
    let mut links = LinkSet::default();
    let mut problems: Vec<CliProblem> = Vec::new();
    let consumer_id = &consumer.settings.id;

    for (kind, provider_id) in links_of(&consumer.settings) {
        let provider = generation
            .entries
            .iter()
            .find(|each| each.settings.id == provider_id);
        let provider_api = provider.and_then(|each| paired_api(each, consumer_api));
        let known_kind = is_link_kind(kind)?;

        // The link checks of the plan refused these cases before any target ran.
        let (Some(provider), Some(provider_api), Some(kind)) = (provider, provider_api, known_kind)
        else {
            return Err(InternalError::new(format!(
                "the link {kind} of {consumer_id} to {provider_id} passed the plan's checks unpaired"
            ))
            .into());
        };

        let location = format!(
            "entry '{consumer_id}' linked to '{provider_id}', api '{}'",
            consumer_api.api
        );

        match generation.describe.of(provider, provider_api) {
            Err(TargetFailure::Internal(error)) => return Err(error.clone().into()),
            Err(TargetFailure::Refused(refused)) => {
                let provider_ir = provider_api
                    .ir
                    .to_json_value()
                    .map_err(|error| InternalError::new(error.to_string()))?;
                let positions = ContractPositions {
                    ir: &provider_ir,
                    locations: provider_api.located.as_ref(),
                };

                problems.extend(refused.0.iter().map(|refusal| {
                    problem_from_refusal(&with_docs(refusal), location.clone(), Some(&positions))
                }));
            }
            Ok(descriptors) => {
                let link_location = relative_location(&consumer_api.root, &provider_api.root)?;

                if !add_link(&mut links, kind, descriptors.clone(), link_location)? {
                    problems.push(located_problem(
                        "link.kind.not-described",
                        format!(
                            "'{provider_id}' declares that it provides '{kind}', and its describe returned no '{kind}' descriptor.",
                            kind = kind.as_str()
                        ),
                        &format!(
                            "Report it to the maintainers of {}.",
                            provider.target.metadata().id
                        ),
                        location,
                    ));
                }
            }
        }
    }

    Problems::refuse_any(problems)?;

    Ok(links)
}
