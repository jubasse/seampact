//! `seampact bundle`: writes the bundle of a `path` source and prints its integrity.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_bundle::{
    BundleBuildOptions, BundleNamedVersionOverride, BundleOutput, BundleWriteOptions,
    BundleWriteResult, write_bundle,
};
use seampact_bundle_fetch::BundleSourceFailure;
use seampact_cli_config::{
    CliProblem, LoadedAppConfig, ReadAppConfigOutcome, ResolvedSource, read_app_config,
    resolved_path,
};

use crate::cli_problem::unlocated_problem;
use crate::compile_sources::{bundle_problem, no_workspace_problem, print_source_diagnostics};
use crate::config_location::ConfigLocation;
use crate::source_reader::source_reader;
use crate::workspace_api_names::source_entry_file;
use crate::{CliError, CliIo, EXIT_SUCCESS, refuse};

/// The flags that each name where the bundle is written; a command line gives exactly one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum BundleOutputFlag {
    /// `--out`: a directory.
    Out,
    /// `--tarball`: a tarball file.
    Tarball,
    /// `--npm-package`: a directory ready for `npm publish`.
    NpmPackage,
}

impl BundleOutputFlag {
    /// Every flag, in the order the command line is checked.
    pub(crate) const ALL: [Self; 3] = [Self::Out, Self::Tarball, Self::NpmPackage];

    /// The option name, without its leading `--`.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Out => "out",
            Self::Tarball => "tarball",
            Self::NpmPackage => "npm-package",
        }
    }

    /// The output the flag names at `path`.
    pub(crate) fn output(self, path: &str) -> BundleOutput {
        let path = Utf8PathBuf::from(path);

        match self {
            Self::Out => BundleOutput::Directory(path),
            Self::Tarball => BundleOutput::Tarball(path),
            Self::NpmPackage => BundleOutput::NpmPackage(path),
        }
    }
}

/// What `bundle` was asked.
#[derive(Debug)]
pub(crate) struct BundleCommandOptions {
    pub(crate) output: BundleOutput,
    pub(crate) contract: BundleNamedVersionOverride,
    /// `--source`: the `path` source to bundle, by name.
    pub(crate) source: Option<String>,
}

/// A `path` source of the app config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PathSource {
    pub(crate) name: String,
    pub(crate) directory: Utf8PathBuf,
}

/// The source to bundle, or why there is none.
#[derive(Debug, Clone, PartialEq)]
enum SourceChoice {
    Chosen(PathSource),
    Refused(CliProblem),
}

/// Writes the bundle of the chosen `path` source; answers the exit code.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read or written, [`CliError::Internal`] for a bug.
pub(crate) fn bundle_command(
    location: &ConfigLocation,
    options: &BundleCommandOptions,
    io: &mut dyn CliIo,
) -> Result<i32, CliError> {
    let config = match read_app_config(&location.file, &location.display_name, None)? {
        ReadAppConfigOutcome::Refused(problems) => return Ok(refuse(io, &problems)),
        ReadAppConfigOutcome::Read(config) => config,
    };
    let source = match chosen_source(&config, options.source.as_deref()) {
        SourceChoice::Refused(problem) => return Ok(refuse(io, &[problem])),
        SourceChoice::Chosen(source) => source,
    };
    let Some(entry) = source_entry_file(&source.directory) else {
        return Ok(refuse(
            io,
            &[no_workspace_problem(&source.name, &source.directory)],
        ));
    };
    let output = resolved_output(io.cwd(), &options.output);
    let reader = source_reader(&source.directory)?;
    let written = write_bundle(&BundleWriteOptions {
        build: BundleBuildOptions {
            reader: &reader,
            entry,
            contract: Some(options.contract.clone()),
        },
        output: output.clone(),
    })?;

    match written {
        BundleWriteResult::Failed { failures, compiled } => {
            if let Some(compiled) = compiled {
                print_source_diagnostics(io, &source.name, &source.directory, &compiled)?;
            }

            let location = format!("source '{}'", source.name);
            let problems: Vec<CliProblem> = failures
                .into_iter()
                .map(BundleSourceFailure::from)
                .map(|failure| bundle_problem(&failure, &location))
                .collect();

            Ok(refuse(io, &problems))
        }
        BundleWriteResult::Written { manifest, compiled } => {
            print_source_diagnostics(io, &source.name, &source.directory, &compiled)?;

            let names: Vec<&str> = manifest.apis.iter().map(|api| api.name.as_str()).collect();

            io.stdout(&format!(
                "Wrote the bundle of {}@{} ({}) to {}.\nintegrity: {}\n",
                manifest.contract.name,
                manifest.contract.version,
                names.join(", "),
                output_path(&output),
                manifest.integrity
            ));

            Ok(EXIT_SUCCESS)
        }
    }
}

/// The only `path` source, or the one `named`; a problem when there is none or several.
fn chosen_source(config: &LoadedAppConfig, named: Option<&str>) -> SourceChoice {
    let path_sources: Vec<PathSource> = config
        .sources
        .iter()
        .filter_map(|(name, source)| match source {
            ResolvedSource::Path { directory } => Some(PathSource {
                name: name.clone(),
                directory: directory.clone(),
            }),
            ResolvedSource::Bundle(_) => None,
        })
        .collect();

    if let Some(named) = named {
        return named_source(config, named, &path_sources);
    }

    let [only] = path_sources.as_slice() else {
        let problem = if path_sources.is_empty() {
            unlocated_problem(
                "bundle.source.none",
                "The app config has no `path` source, so there is no workspace to bundle."
                    .to_owned(),
                "Add the contract directory under `sources` as `{ path: <dir> }`.",
            )
        } else {
            let listed: Vec<String> = path_sources
                .iter()
                .map(|each| format!("'{}'", each.name))
                .collect();

            unlocated_problem(
                "bundle.source.ambiguous",
                format!(
                    "The app config has several `path` sources ({}).",
                    listed.join(", ")
                ),
                "Name the one to bundle with `--source <name>`.",
            )
        };

        return SourceChoice::Refused(problem);
    };

    SourceChoice::Chosen(only.clone())
}

/// The `path` source `--source` names, or why it cannot be bundled.
fn named_source(
    config: &LoadedAppConfig,
    named: &str,
    path_sources: &[PathSource],
) -> SourceChoice {
    if let Some(found) = path_sources.iter().find(|each| each.name == named) {
        return SourceChoice::Chosen(found.clone());
    }

    if config.sources.contains_key(named) {
        return SourceChoice::Refused(unlocated_problem(
            "bundle.source.not-local",
            format!(
                "The source '{named}' is a bundle source; only a `path` source holds a workspace to bundle."
            ),
            "Name a `path` source with `--source`, or bundle in the repository that holds that contract.",
        ));
    }

    let known: Vec<&str> = config.sources.keys().map(String::as_str).collect();
    let listed = if known.is_empty() {
        "none".to_owned()
    } else {
        known.join(", ")
    };

    SourceChoice::Refused(unlocated_problem(
        "bundle.source.unknown",
        format!("The app config has no source '{named}' ({listed})."),
        "Name one of the app config's `path` sources with `--source`.",
    ))
}

fn resolved_output(cwd: &Utf8Path, output: &BundleOutput) -> BundleOutput {
    match output {
        BundleOutput::Directory(path) => BundleOutput::Directory(resolved_path(cwd, path.as_str())),
        BundleOutput::NpmPackage(path) => {
            BundleOutput::NpmPackage(resolved_path(cwd, path.as_str()))
        }
        BundleOutput::Tarball(path) => BundleOutput::Tarball(resolved_path(cwd, path.as_str())),
    }
}

fn output_path(output: &BundleOutput) -> &Utf8Path {
    match output {
        BundleOutput::Directory(path)
        | BundleOutput::NpmPackage(path)
        | BundleOutput::Tarball(path) => path,
    }
}
