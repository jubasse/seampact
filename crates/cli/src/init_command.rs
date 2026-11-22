//! `seampact init`: writes a new project, or the modelines of an existing one. Every refusal comes
//! before the first write, and every file written or changed is printed.

use std::fs;
use std::io::ErrorKind;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle_fetch::{LocalSourcePolicy, local_source_policy, local_source_refusal_reason};
use seampact_cli_config::{
    CliProblem, RootDiscovery, find_root_config, is_path_taken, resolved_path,
};
use seampact_editor_schemas::DEFAULT_EDITOR_SCHEMAS_DIRECTORY;

use crate::cli_problem::unlocated_problem;
use crate::compile_command::{CompileOutputs, EditorSchemasMode, compile_command};
use crate::compile_sources::run_environment;
use crate::config_location::{APP_CONFIG_FILE_NAME, ConfigLocation, config_location, display_path};
use crate::git_ignore::{GitIgnoreChange, git_ignore_with_entries};
use crate::init_modelines::init_modelines;
use crate::init_starter::{
    STARTER_CONTRACT_FILE, STARTER_SOURCE_DIRECTORY, StarterContent, starter_config,
    starter_contract,
};
use crate::modelines::{INSTALLED_AUTHORING_SCHEMAS, modeline_of, with_modeline};
use crate::not_ported::not_ported_yet;
use crate::{CliError, CliIo, EXIT_SUCCESS, refuse};

/// The ignore entry of the default editor schemas directory, at any depth below the app root.
pub(crate) const DEFAULT_IGNORE_ENTRY: &str = ".seampact/";

/// Where the editor schemas go: written and git-ignored (the default), written and committed, or
/// not written, the modelines then pointing at the installed `@seampact/spec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditorSchemasPolicy {
    Ignore,
    Commit,
    None,
}

impl EditorSchemasPolicy {
    /// The policies in the order the usage error lists them.
    pub(crate) const ALL: [Self; 3] = [Self::Ignore, Self::Commit, Self::None];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Ignore => "ignore",
            Self::Commit => "commit",
            Self::None => "none",
        }
    }
}

/// Whether `init` touches a file of a given sort (`--no-modelines`, `--no-ignore-files`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitWrite {
    Write,
    Skip,
}

/// What `init` was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InitOptions {
    /// `init`: a new project in the working directory.
    NewProject {
        content: StarterContent,
        editor_schemas: EditorSchemasPolicy,
        modelines: InitWrite,
        ignore_files: InitWrite,
    },
    /// `init --modelines`: the modeline of every file of the app config's `path` sources.
    Modelines {
        location: ConfigLocation,
        editor_schemas: EditorSchemasPolicy,
        ignore_files: InitWrite,
    },
}

/// Writes a new project, or the modelines of an existing one; answers the exit code.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read or written, [`CliError::Internal`] for a bug.
pub(crate) fn init_command(options: &InitOptions, io: &mut dyn CliIo) -> Result<i32, CliError> {
    match options {
        InitOptions::NewProject {
            content,
            editor_schemas,
            modelines,
            ignore_files,
        } => init_new_project(*content, *editor_schemas, *modelines, *ignore_files, io),
        InitOptions::Modelines {
            location,
            editor_schemas,
            ignore_files,
        } => init_modelines(location, *editor_schemas, *ignore_files, io),
    }
}

/// What the starter files are made of.
struct StarterWrite {
    config_file: Utf8PathBuf,
    config: String,
    source_directory: Utf8PathBuf,
    contract_file: Utf8PathBuf,
    contract: String,
    editor_schemas: EditorSchemasPolicy,
}

fn init_new_project(
    content: StarterContent,
    editor_schemas: EditorSchemasPolicy,
    modelines: InitWrite,
    ignore_files: InitWrite,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let config_file = resolved_path(io.cwd(), APP_CONFIG_FILE_NAME);
    let source_directory = resolved_path(io.cwd(), STARTER_SOURCE_DIRECTORY);
    let contract_file = resolved_path(&source_directory, STARTER_CONTRACT_FILE);
    let mut existing: Vec<Utf8PathBuf> = Vec::new();

    for path in [&config_file, &source_directory] {
        if is_path_taken(path)? {
            existing.push(path.clone());
        }
    }

    if !existing.is_empty() {
        let problem = file_exists_problem(io, &existing);

        return Ok(refuse(io, &[problem]));
    }

    if let Some(refusal) = local_sources_refusal(&config_file, io)? {
        return Ok(refuse(io, &[refusal]));
    }

    let ignore = planned_ignore(
        io.cwd(),
        editor_schemas,
        ignore_files,
        &[DEFAULT_IGNORE_ENTRY],
    )?;

    if let Some(GitIgnoreChange::Link { file }) = &ignore {
        let problem = ignore_file_link_problem(io, file)?;

        return Ok(refuse(io, &[problem]));
    }

    let schema_directory = match editor_schemas {
        EditorSchemasPolicy::None => resolved_path(io.cwd(), INSTALLED_AUTHORING_SCHEMAS),
        EditorSchemasPolicy::Ignore | EditorSchemasPolicy::Commit => {
            resolved_path(&source_directory, DEFAULT_EDITOR_SCHEMAS_DIRECTORY)
        }
    };
    let contract = starter_contract(content);
    let contract = match modelines {
        InitWrite::Write => with_modeline(
            contract,
            &modeline_of(&contract_file, &schema_directory, "api"),
        ),
        InitWrite::Skip => contract.to_owned(),
    };
    let written = write_starter(
        io,
        &StarterWrite {
            config_file,
            config: starter_config(content),
            source_directory,
            contract_file,
            contract,
            editor_schemas,
        },
    )?;

    if written != EXIT_SUCCESS {
        return Ok(written);
    }

    write_ignore(io, ignore.as_ref())?;
    io.stdout("Run `seampact compile` after each change to the contract.\n");

    Ok(EXIT_SUCCESS)
}

/// Writes the config, the contract and its editor schemas; when a step fails, removes what it
/// wrote, which did not exist before, so the folder is left as it was.
fn write_starter(io: &mut dyn CliIo, starter: &StarterWrite) -> Result<i32, CliError> {
    match write_starter_files(io, starter) {
        Ok(EXIT_SUCCESS) => Ok(EXIT_SUCCESS),
        Ok(compiled) => {
            remove_written(io, starter)?;

            Ok(compiled)
        }
        Err(error) => {
            remove_written(io, starter)?;

            Err(error)
        }
    }
}

fn write_starter_files(io: &mut dyn CliIo, starter: &StarterWrite) -> Result<i32, CliError> {
    fs::write(&starter.config_file, &starter.config)
        .map_err(|error| CliError::io(&starter.config_file, &error))?;
    io.stdout(&format!(
        "Created {}.\n",
        display_path(io.cwd(), &starter.config_file)
    ));
    fs::create_dir(&starter.source_directory)
        .map_err(|error| CliError::io(&starter.source_directory, &error))?;
    fs::write(&starter.contract_file, &starter.contract)
        .map_err(|error| CliError::io(&starter.contract_file, &error))?;
    io.stdout(&format!(
        "Created {}.\n",
        display_path(io.cwd(), &starter.contract_file)
    ));

    if starter.editor_schemas == EditorSchemasPolicy::None {
        return Ok(EXIT_SUCCESS);
    }

    compile_command(
        &config_location(io.cwd(), None),
        &CompileOutputs {
            ir_out_dir: None,
            editor_schemas: EditorSchemasMode::Write,
        },
        io,
    )
}

fn remove_written(io: &mut dyn CliIo, starter: &StarterWrite) -> Result<(), CliError> {
    ignore_missing(fs::remove_file(&starter.config_file), &starter.config_file)?;
    ignore_missing(
        fs::remove_dir_all(&starter.source_directory),
        &starter.source_directory,
    )?;
    io.stderr(&format!(
        "Removed {} and {}: init left nothing behind.\n",
        display_path(io.cwd(), &starter.config_file),
        display_path(io.cwd(), &starter.source_directory)
    ));

    Ok(())
}

/// A removal that finds nothing there succeeded, as `rm --force` does.
fn ignore_missing(removed: std::io::Result<()>, path: &Utf8Path) -> Result<(), CliError> {
    match removed {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(CliError::io(path, &error)),
        Ok(()) | Err(_) => Ok(()),
    }
}

/// The refusal when local sources are refused here, and the starter contract is a local folder.
fn local_sources_refusal(
    config_file: &Utf8Path,
    io: &dyn CliIo,
) -> Result<Option<CliProblem>, CliError> {
    let root_allow_local = match find_root_config(config_file, APP_CONFIG_FILE_NAME)? {
        RootDiscovery::Found { root, listed: true } => root.allow_local,
        RootDiscovery::Found { .. } | RootDiscovery::None | RootDiscovery::Refused(_) => None,
    };
    let environment = run_environment(io);

    if local_source_policy(root_allow_local, &environment) == LocalSourcePolicy::Allow {
        return Ok(None);
    }

    Ok(Some(unlocated_problem(
        "init.local-sources-refused",
        format!(
            "The starter contract is a local folder, and local sources are refused here ({}); nothing was written.",
            local_source_refusal_reason(&environment)
        ),
        "Run `seampact init` where local sources are allowed, or write the app config yourself with a `package` source.",
    )))
}

/// How `.gitignore` would change, when `init` touches it at all.
pub(crate) fn planned_ignore(
    directory: &Utf8Path,
    editor_schemas: EditorSchemasPolicy,
    ignore_files: InitWrite,
    entries: &[&str],
) -> Result<Option<GitIgnoreChange>, CliError> {
    if editor_schemas != EditorSchemasPolicy::Ignore
        || ignore_files == InitWrite::Skip
        || entries.is_empty()
    {
        return Ok(None);
    }

    git_ignore_with_entries(directory, entries).map(Some)
}

/// Writes the `.gitignore` the plan changes and says so.
pub(crate) fn write_ignore(
    io: &mut dyn CliIo,
    ignore: Option<&GitIgnoreChange>,
) -> Result<(), CliError> {
    let (file, text, done) = match ignore {
        Some(GitIgnoreChange::Created { file, text }) => (file, text, "Created"),
        Some(GitIgnoreChange::Appended { file, text }) => {
            (file, text, "Added the editor schemas to")
        }
        Some(GitIgnoreChange::Unchanged { .. } | GitIgnoreChange::Link { .. }) | None => {
            return Ok(());
        }
    };

    fs::write(file, text).map_err(|error| CliError::io(file, &error))?;
    io.stdout(&format!("{done} {}.\n", display_path(io.cwd(), file)));

    Ok(())
}

/// The refusal when `.gitignore` is a symbolic link.
pub(crate) fn ignore_file_link_problem(
    _io: &dyn CliIo,
    _file: &Utf8Path,
) -> Result<CliProblem, CliError> {
    Err(not_ported_yet("ignoreFileLinkProblem"))
}

/// The refusal when the app config names no `path` source.
pub(crate) fn no_path_source_problem(_location: &ConfigLocation) -> Result<CliProblem, CliError> {
    Err(not_ported_yet("noPathSourceProblem"))
}

/// The refusal when `existing` files already stand where a new project goes.
pub(crate) fn file_exists_problem(io: &dyn CliIo, existing: &[Utf8PathBuf]) -> CliProblem {
    let names: Vec<String> = existing
        .iter()
        .map(|path| display_path(io.cwd(), path))
        .collect();
    let verb = if existing.len() == 1 {
        "already exists"
    } else {
        "already exist"
    };

    unlocated_problem(
        "init.file-exists",
        format!(
            "`seampact init` writes a new project here, and {} {verb}; nothing was written.",
            names.join(" and ")
        ),
        "Run `seampact init` in a folder without them, or run `seampact init --modelines` to add the modelines to the contracts of an existing app config.",
    )
}
