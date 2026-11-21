//! The commands of the CLI, in the order the usage text lists them, with their usage lines.

/// One command of the CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Command {
    Init,
    Compile,
    Generate,
    Check,
    Lint,
    Diff,
    Explain,
    Bundle,
}

impl Command {
    /// Every command, in the order of the usage text.
    pub(crate) const ALL: [Self; 8] = [
        Self::Init,
        Self::Compile,
        Self::Generate,
        Self::Check,
        Self::Lint,
        Self::Diff,
        Self::Explain,
        Self::Bundle,
    ];

    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|command| command.as_str() == name)
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::Compile => "compile",
            Self::Generate => "generate",
            Self::Check => "check",
            Self::Lint => "lint",
            Self::Diff => "diff",
            Self::Explain => "explain",
            Self::Bundle => "bundle",
        }
    }

    /// The command's lines of the usage text.
    pub(crate) const fn usage(self) -> &'static str {
        match self {
            Self::Init => {
                "  init [--blank] [--editor-schemas[=ignore|commit|none]] [--no-modelines] [--no-ignore-files]\n                                           Write a new project here: seampact.config.yaml and contract/api.yaml, a small example (--blank: the api header alone), with its modeline and editor schemas, git-ignored by default.\n  init --modelines [--config <path>] [--editor-schemas[=ignore|commit|none]] [--no-ignore-files]\n                                           Write or correct the modeline of every contract file of the app config's `path` sources, and their editor schemas."
            }
            Self::Compile => {
                "  compile [--config <path>] [--out <dir>] [--editor-schemas]\n                                           Compile the contract sources the app config's targets use; --editor-schemas writes each contract's editor schemas, which check declared names (to workspace.editorSchemas, .seampact/schemas by default)."
            }
            Self::Generate => {
                "  generate [--config <path>] [--force] [--app-directory <dir> [--config-name <label>]] [--bundle-directory <source>=<dir>]\n                                           Generate every target entry of the app config, or of every app a root config lists; --force overwrites, or removes when stale, a generated file edited by hand. A build plugin passes --app-directory (the --config text read as that directory's app config, named --config-name in problems) and --bundle-directory (a bundle it already fetched, checked against the source's integrity, never fetched)."
            }
            Self::Check => {
                "  check [--config <path>] [--app-directory <dir> [--config-name <label>]] [--bundle-directory <source>=<dir>]\n                                           Fail when the committed generated files or documents differ from a fresh run; --app-directory, --config-name and --bundle-directory as for generate."
            }
            Self::Lint => {
                "  lint [--config <path>]                   Run the core lint rules over each contract source."
            }
            Self::Diff => {
                "  diff --against <path> [--config <path>]  Classify the changes since the IRs at <path> (an IR file, or a directory of <api>.ir.json that \"compile --out <dir>\" writes)."
            }
            Self::Explain => {
                "  explain <api>.<operationId> [--config <path>]  Print one operation whole, each line commented with the derivation and the file and line it comes from; the api may be left out when the sources hold one."
            }
            Self::Bundle => {
                "  bundle (--out <dir> | --tarball <file> | --npm-package <dir>) [--source <name>] [--name <name>] [--version <version>] [--config <path>]\n                                           Write the bundle of a `path` source (the config's only one, or --source) and print its integrity; the contract name and version default to the workspace's package.json."
            }
        }
    }
}
