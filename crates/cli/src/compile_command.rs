//! `seampact compile`: compiles the sources the targets use, then writes IR files and editor
//! schemas when asked.

use std::fs;

use camino::Utf8Path;
use seampact_cli_config::CliIo;
use seampact_cli_config::unlocated_problem;
use seampact_cli_config::{
    CliProblem, LoadedAppConfig, ReadAppConfigOutcome, ResolvedSource, open_api_api_names,
    read_app_config, resolved_path,
};
use seampact_diagnostics::InternalError;
use seampact_editor_schemas::{
    EditorSchemasPlan, EditorSchemasPlanOutcome, EditorSchemasSource, editor_declarations,
    plan_editor_schemas, write_editor_schemas,
};
use seampact_finalize::finalize_serialize_ir;
use seampact_generate::LocalBundles;
use seampact_generate::source_entry_file;
use seampact_generate::source_reader;
use seampact_generate::{CompiledApi, compile_sources};
use seampact_generate::{UsedSources, add_qualify_fix, entry_api_refs, used_sources};
use seampact_paths::RelativeOutputPath;

use crate::config_location::ConfigLocation;
use crate::{CliError, EXIT_SUCCESS, refuse};

/// The suffix of the IR file `compile --out` writes for an api.
pub(crate) const IR_FILE_SUFFIX: &str = ".ir.json";

/// Whether `compile` writes the editor schemas of its sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum EditorSchemasMode {
    /// `--editor-schemas`.
    Write,
    /// No editor schemas.
    Skip,
}

/// What `compile` writes besides checking the contracts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompileOutputs {
    /// `--out`: the directory of the IR files, as given.
    pub(crate) ir_out_dir: Option<String>,
    pub(crate) editor_schemas: EditorSchemasMode,
}

/// The editor schemas to write, or the problems that stop all writing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PlannedEditorSchemas {
    pub(crate) problems: Vec<CliProblem>,
    pub(crate) plans: Vec<(String, EditorSchemasPlan)>,
}

/// Compiles the sources the app config's targets use and writes what `outputs` asks for; answers
/// the exit code.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read or written, [`CliError::Internal`] for a bug.
pub(crate) fn compile_command(
    location: &ConfigLocation,
    outputs: &CompileOutputs,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let extra_refs = open_api_api_names(&config)?;
    let used_names = match used_sources(&config, &extra_refs)? {
        UsedSources::Refused(problems) => return Ok(refuse(io, &problems)),
        UsedSources::Used(names) => names,
    };
    let compiled = compile_sources(&config, &used_names, &LocalBundles::new(), io)?;

    if compiled.failed {
        let mut refs = entry_api_refs(&config);

        refs.extend(extra_refs.iter().map(String::as_str));

        return Ok(refuse(io, &add_qualify_fix(compiled.problems, &refs)));
    }

    if outputs.ir_out_dir.is_none() && outputs.editor_schemas == EditorSchemasMode::Skip {
        io.stdout(&format!(
            "Compiled {} api(s) without error.\n",
            compiled.apis.len()
        ));

        return Ok(EXIT_SUCCESS);
    }

    let collisions = match outputs.ir_out_dir {
        Some(_) => same_name_problems(&compiled.apis),
        None => Vec::new(),
    };

    if !collisions.is_empty() {
        return Ok(refuse(io, &collisions));
    }

    // Every refusal comes before the first write.
    let planned = match outputs.editor_schemas {
        EditorSchemasMode::Write => {
            plan_sources_editor_schemas(&config, &used_names, &compiled.apis, io)?
        }
        EditorSchemasMode::Skip => PlannedEditorSchemas::default(),
    };

    if !planned.problems.is_empty() {
        return Ok(refuse(io, &planned.problems));
    }

    if let Some(out_dir) = &outputs.ir_out_dir {
        write_ir_files(&compiled.apis, &resolved_path(io.cwd(), out_dir), io)?;
    }

    for (name, plan) in &planned.plans {
        let file_count = write_editor_schemas(plan)?;

        io.stdout(&format!(
            "Wrote {file_count} editor schema(s) of source '{name}' to {}.\n",
            plan.directory
        ));
    }

    Ok(EXIT_SUCCESS)
}

/// One problem for each api that an earlier source already holds under the same name.
fn same_name_problems(apis: &[CompiledApi]) -> Vec<CliProblem> {
    apis.iter()
        .enumerate()
        .filter(|(index, each)| apis.iter().position(|other| other.api == each.api) != Some(*index))
        .map(|(_, each)| {
            unlocated_problem(
                "compile.out.collision",
                format!(
                    "Several sources hold an api '{}', and each would be written to {}{IR_FILE_SUFFIX}.",
                    each.api, each.api
                ),
                "Compile without `--out`, or keep one source holding that api in the app config.",
            )
        })
        .collect()
}

fn write_ir_files(
    apis: &[CompiledApi],
    directory: &Utf8Path,
    io: &mut dyn CliIo,
) -> Result<(), CliError> {
    fs::create_dir_all(directory).map_err(|error| CliError::io(directory, &error))?;

    for each in apis {
        let name = RelativeOutputPath::try_new(format!("{}{IR_FILE_SUFFIX}", each.api))
            .map_err(|error| CliError::io(directory, &std::io::Error::other(error)))?;
        let file = directory.join(name.as_path());

        fs::write(&file, finalize_serialize_ir(&each.ir)?)
            .map_err(|error| CliError::io(&file, &error))?;
    }

    io.stdout(&format!(
        "Wrote {} IR file(s) to {directory}.\n",
        apis.len()
    ));

    Ok(())
}

/// Checks where the editor schemas of each `path` source go and writes nothing; a bundle source
/// has none.
///
/// # Errors
///
/// [`CliError::Io`] or [`CliError::EditorSchemas`] when the checks cannot read the file system,
/// [`CliError::Internal`] for a bug.
pub(crate) fn plan_sources_editor_schemas(
    config: &LoadedAppConfig,
    names: &[String],
    apis: &[CompiledApi],
    io: &mut dyn CliIo,
) -> Result<PlannedEditorSchemas, CliError> {
    let mut planned = PlannedEditorSchemas::default();

    for name in names {
        let Some(source) = config.sources.get(name) else {
            return Err(
                InternalError::new(format!("no source named {name} in the app config")).into(),
            );
        };
        let ResolvedSource::Path { directory } = source else {
            io.stdout(&format!(
                "Source '{name}' is a bundle, whose files are not edited: no editor schemas.\n"
            ));

            continue;
        };

        // compile_sources refused a directory without an entry file already.
        let Some(entry) = source_entry_file(directory) else {
            return Err(InternalError::new(format!("the source {name} has no entry file")).into());
        };
        let reader = source_reader(directory)?;
        let mut declarations = Vec::new();

        for api in apis.iter().filter(|api| api.source == *name) {
            if let Some(input) = &api.lint_input {
                declarations.extend(editor_declarations(
                    &api.api,
                    Some(&input.declared),
                    &input.located,
                )?);
            }
        }

        let outcome = plan_editor_schemas(&EditorSchemasSource {
            name,
            directory,
            entry,
            reader: &reader,
            declarations: &declarations,
        })?;

        match outcome {
            EditorSchemasPlanOutcome::Refused(problem) => planned.problems.push(problem),
            EditorSchemasPlanOutcome::Planned(plan) => planned.plans.push((name.clone(), plan)),
        }
    }

    Ok(planned)
}
