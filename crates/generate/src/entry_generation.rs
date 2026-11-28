//! The files of every entry of an app, generated in memory in link order.

use std::collections::HashMap;

use seampact_cli_config::{
    CliProblem, HookBootCheckLevel, PlannedAppDocument, Problems, TargetEntrySettings, entry_where,
    hook_check_level_of, located_problem,
};
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use seampact_target::{
    DescriptorSet, GENERATE_TROUBLESHOOTING_URL, GenerateRequest, GenerateWarning, HookBootCheck,
    ImportSpecifierStyle, LINK_TROUBLESHOOTING_URL, LinkSet, NATIVE_DOCS_ARTEFACT, Refusal,
    TargetFailure,
};
use seampact_writer::{HeaderSource, check_generated_paths, finish_files};

use crate::drift_level::DEFAULT_DRIFT_CHECK_LEVEL;
use crate::entry_links::{links_of, paired_api};
use crate::exclusive_base_paths::exclusive_base_path_problems;
use crate::framework_route_check::framework_route_check_of;
use crate::generated_output::GeneratedApi;
use crate::import_specifier_styles::import_specifier_styles;
use crate::link_set::{add_link, is_link_kind, relative_location};
use crate::native_docs_document::native_docs_document_of;
use crate::planned_entry::{PlannedApi, PlannedEntry};
use crate::refusal_problem::problems_at_api;
use crate::stop::{Stop, gather};
use crate::{AppPlan, GeneratedOutput};

const LINK_CODE_PREFIX: &str = "link.";

/// The suffix of the code of a warning a form's own code stands for.
const HANDLER_WARNING_SUFFIX: &str = ".handler";

/// What describing a provider's api answers.
type DescribeOutcome = Result<DescriptorSet, TargetFailure>;

/// What a run keeps while it generates the entries of an app.
pub(crate) struct EntryGeneration<'plan> {
    /// Every planned entry.
    pub(crate) entries: &'plan [PlannedEntry],
    /// The describe answers already known.
    pub(crate) describe: Describe,
    /// The documents the app writes.
    pub(crate) app_documents: Vec<&'plan PlannedAppDocument>,
    /// The warning codes the config ignores.
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
/// [`Stop::Refused`] with the problems of every api the targets refuse; [`Stop::Failed`] for a
/// bug or a file the run cannot read.
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
    consumer: &PlannedEntry,
    planned_api: &PlannedApi,
    style: Option<ImportSpecifierStyle>,
    generation: &mut EntryGeneration<'_>,
) -> Result<GeneratedApi, Stop> {
    let settings = &consumer.settings;
    let links = build_links(consumer, planned_api, generation)?;
    let native_docs = if consumer.artefacts.is_on(NATIVE_DOCS_ARTEFACT) {
        Some(native_docs_document_of(
            settings,
            planned_api,
            &generation.app_documents,
        )?)
    } else {
        None
    };
    let framework_routes = framework_route_check_of(settings);
    let mut request = GenerateRequest::new(&planned_api.ir)
        .with_needs(&consumer.needs)
        .with_links(&links)
        .with_artefacts(&consumer.artefacts)
        .with_framework_routes(&framework_routes)
        .with_hook_check(hook_boot_check_of(settings))
        .with_installed_runtimes(&consumer.installed_runtimes);

    if let Some(options) = &settings.options {
        request = request.with_options(options);
    }

    if let Some(mount) = &settings.mount {
        request = request.with_mount(mount);
    }

    if let Some(style) = style {
        request = request.with_import_specifiers(style);
    }

    if let Some(document) = &native_docs {
        request = request.with_native_docs_document(document);
    }

    let generated = match consumer.target.generate(&request) {
        Ok(generated) => generated,
        Err(TargetFailure::Internal(error)) => return Err(error.into()),
        Err(TargetFailure::Refused(refused)) => {
            return Err(refusal_stop(&refused.0, settings, planned_api)?);
        }
    };
    let metadata = consumer.target.metadata();
    let header = HeaderSource {
        version: metadata.version,
        short_id: metadata.id.as_str(),
        api_id: planned_api.ir.api.id.as_str(),
    };
    let files = match check_generated_paths(generated.files)
        .and_then(|checked| finish_files(checked, &header))
    {
        Ok(files) => files,
        Err(refused) => return Err(refusal_stop(&refused.0, settings, planned_api)?),
    };

    Ok(GeneratedApi {
        entry_id: settings.id.clone(),
        api: planned_api.api.clone(),
        root: planned_api.root.clone(),
        files,
        warnings: generated
            .warnings
            .into_iter()
            .filter(|warning| !is_ignored_warning(warning, generation.ignored_warnings))
            .collect(),
    })
}

/// The refusal of a run whose target or writer refused `refusals` for `planned_api`.
fn refusal_stop(
    refusals: &[Refusal],
    settings: &TargetEntrySettings,
    planned_api: &PlannedApi,
) -> Result<Stop, InternalError> {
    let documented: Vec<Refusal> = refusals.iter().map(with_docs).collect();
    let problems = problems_at_api(
        &documented,
        |refusal| refusal_where(settings, &planned_api.api, &refusal.code),
        planned_api,
    )?;

    Ok(Problems::new(problems).into())
}

fn hook_boot_check_of(entry: &TargetEntrySettings) -> HookBootCheck {
    match hook_check_level_of(entry.artefacts.as_ref()) {
        HookBootCheckLevel::Error => HookBootCheck::Error,
        HookBootCheckLevel::Warn => HookBootCheck::Warn,
        HookBootCheckLevel::Off => HookBootCheck::Off,
    }
}

/// Whether the config ignores `warning`: its code is a form it names, or that form's handler code.
fn is_ignored_warning(warning: &GenerateWarning, ignored_forms: &[String]) -> bool {
    ignored_forms.iter().any(|form| {
        warning.code == *form
            || warning
                .code
                .strip_suffix(HANDLER_WARNING_SUFFIX)
                .is_some_and(|code| code == form)
    })
}

/// `refusal` with the troubleshooting section of its code when it names none.
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
        let known_kind = is_link_kind(kind);

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
                let documented: Vec<Refusal> = refused.0.iter().map(with_docs).collect();

                problems.extend(problems_at_api(
                    &documented,
                    |_| location.clone(),
                    provider_api,
                )?);
            }
            Ok(descriptors) => {
                let link_location = relative_location(&consumer_api.root, &provider_api.root);

                if !add_link(&mut links, kind, descriptors, link_location) {
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
