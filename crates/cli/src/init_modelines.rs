//! `seampact init --modelines`: the modeline of every file of the app config's `path` sources.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{
    ReadAppConfigOutcome, ResolvedSource, directory_of, is_strictly_inside, read_app_config,
    relative_path, resolved_path,
};
use seampact_diagnostics::InternalError;
use seampact_editor_schemas::{DEFAULT_EDITOR_SCHEMAS_DIRECTORY, write_editor_schemas};
use seampact_load::{LoadOptions, load_workspace};
use std::fs;

use crate::compile_command::{PlannedEditorSchemas, plan_sources_editor_schemas};
use crate::compile_sources::compile_sources;
use crate::config_location::{ConfigLocation, display_path};
use crate::git_ignore::GitIgnoreChange;
use crate::init_command::{
    DEFAULT_IGNORE_ENTRY, EditorSchemasPolicy, InitWrite, ignore_file_link_problem,
    no_path_source_problem, planned_ignore, write_ignore,
};
use crate::local_bundle::LocalBundles;
use crate::modelines::{
    INSTALLED_AUTHORING_SCHEMAS, modeline_of, with_modeline, workspace_file_kinds,
};
use crate::source_reader::source_reader;
use crate::workspace_api_names::source_entry_file;
use crate::{CliError, CliIo, EXIT_SUCCESS, refuse};

/// A file whose modeline is missing or points elsewhere, and the text it gets.
struct ModelineEdit {
    file: Utf8PathBuf,
    text: String,
}

/// Writes the modelines of the `path` sources of the app config at `location`, and their editor
/// schemas; answers the exit code.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read or written, [`CliError::Internal`] for a bug.
pub(crate) fn init_modelines(
    location: &ConfigLocation,
    editor_schemas: EditorSchemasPolicy,
    ignore_files: InitWrite,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let app_root = directory_of(&config.file);
    let sources: Vec<(&String, &Utf8PathBuf)> = config
        .sources
        .iter()
        .filter_map(|(name, source)| match source {
            ResolvedSource::Path { directory } => Some((name, directory)),
            ResolvedSource::Bundle(_) => None,
        })
        .collect();

    if sources.is_empty() {
        return Ok(refuse(io, &[no_path_source_problem(location)]));
    }

    let names: Vec<String> = sources.iter().map(|(name, _)| (*name).clone()).collect();
    let compiled = compile_sources(&config, &names, &LocalBundles::new(), io)?;

    if compiled.failed {
        return Ok(refuse(io, &compiled.problems));
    }

    let planned = match editor_schemas {
        EditorSchemasPolicy::None => PlannedEditorSchemas::default(),
        EditorSchemasPolicy::Ignore | EditorSchemasPolicy::Commit => {
            plan_sources_editor_schemas(&config, &names, &compiled.apis, io)?
        }
    };

    if !planned.problems.is_empty() {
        return Ok(refuse(io, &planned.problems));
    }

    let mut edits: Vec<ModelineEdit> = Vec::new();
    let mut ignore_entries: Vec<String> = Vec::new();

    for (name, directory) in sources {
        let plan = planned
            .plans
            .iter()
            .find(|(planned_name, _)| planned_name == name)
            .map(|(_, plan)| plan);
        let schema_directory = match plan {
            Some(plan) => plan.directory.clone(),
            None => resolved_path(&app_root, INSTALLED_AUTHORING_SCHEMAS),
        };

        edits.extend(modeline_edits(directory, &schema_directory, io)?);

        let Some(plan) = plan else {
            continue;
        };

        if is_strictly_inside(&app_root, &plan.directory) {
            ignore_entries.push(ignore_entry(&app_root, directory, &plan.directory));
        } else {
            io.stdout(&format!(
                "The editor schemas of source '{name}' are outside {}, so its .gitignore does not list them.\n",
                display_path(io.cwd(), &app_root)
            ));
        }
    }

    let entries: Vec<&str> = ignore_entries.iter().map(String::as_str).collect();
    let ignore = planned_ignore(&app_root, editor_schemas, ignore_files, &entries)?;

    if let Some(GitIgnoreChange::Link { file }) = &ignore {
        let problem = ignore_file_link_problem(io, file);

        return Ok(refuse(io, &[problem]));
    }

    for edit in &edits {
        fs::write(&edit.file, &edit.text).map_err(|error| CliError::io(&edit.file, &error))?;
        io.stdout(&format!(
            "Wrote the modeline of {}.\n",
            display_path(io.cwd(), &edit.file)
        ));
    }

    if edits.is_empty() {
        io.stdout("Every modeline was already right.\n");
    }

    for (name, plan) in &planned.plans {
        let file_count = write_editor_schemas(plan)?;

        io.stdout(&format!(
            "Wrote {file_count} editor schema(s) of source '{name}' to {}.\n",
            plan.directory
        ));
    }

    write_ignore(io, ignore.as_ref())?;

    Ok(EXIT_SUCCESS)
}

/// The files of one workspace whose modeline is missing or points elsewhere; each file left
/// without one is printed.
fn modeline_edits(
    source_directory: &Utf8Path,
    schema_directory: &Utf8Path,
    io: &mut dyn CliIo,
) -> Result<Vec<ModelineEdit>, CliError> {
    // compile_sources refused a directory without an entry file already.
    let Some(entry) = source_entry_file(source_directory) else {
        return Err(
            InternalError::new(format!("the source {source_directory} has no entry file")).into(),
        );
    };
    let reader = source_reader(source_directory)?;
    let load = load_workspace(&LoadOptions {
        reader: &reader,
        entry,
    })?;
    let file_kinds = workspace_file_kinds(&load);
    let mut edits = Vec::new();

    for (file, kind) in &file_kinds.kinds {
        let absolute = resolved_path(source_directory, file);
        let bytes = fs::read(&absolute).map_err(|error| CliError::io(&absolute, &error))?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let changed = with_modeline(&text, &modeline_of(&absolute, schema_directory, kind));

        if changed != text {
            edits.push(ModelineEdit {
                file: absolute,
                text: changed,
            });
        }
    }

    for left_out in &file_kinds.left_out {
        io.stdout(&format!(
            "Left {} without a modeline: {}.\n",
            display_path(io.cwd(), &resolved_path(source_directory, &left_out.file)),
            left_out.reason
        ));
    }

    Ok(edits)
}

/// The `.gitignore` entry of the editor schemas of one source.
fn ignore_entry(
    app_root: &Utf8Path,
    source_directory: &Utf8Path,
    schema_directory: &Utf8Path,
) -> String {
    if posix_relative(source_directory, schema_directory) == DEFAULT_EDITOR_SCHEMAS_DIRECTORY {
        return DEFAULT_IGNORE_ENTRY.to_owned();
    }

    format!("/{}/", posix_relative(app_root, schema_directory))
}

fn posix_relative(from: &Utf8Path, to: &Utf8Path) -> String {
    relative_path(from, to).to_string()
}
