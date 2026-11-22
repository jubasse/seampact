//! The two entries of the CLI: [`run_command`] dispatches one command line, [`run_cli`] answers
//! a function not ported yet with `cli.not-ported`.

use std::ffi::OsString;

use seampact_bundle::BundleNamedVersionOverride;
use seampact_cli_config::CliProblem;

use crate::bundle_command::{BundleCommandOptions, BundleOutputFlag, bundle_command};
use crate::cli_problem::unlocated_problem;
use crate::command::Command;
use crate::compile_command::{CompileOutputs, EditorSchemasMode, compile_command};
use crate::config_location::config_location;
use crate::diff_command::diff_command;
use crate::explain_command::explain_command;
use crate::init_command::{EditorSchemasPolicy, InitOptions, InitWrite, init_command};
use crate::init_starter::StarterContent;
use crate::lint_command::lint_command;
use crate::not_ported::not_ported_yet;
use crate::{
    CliError, CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE, OptionKind, OptionSpec, ParsedArgs,
    Positionals, parse_command_args, print_problems,
};

/// The flags of the CLI design that are not available yet; each answers with exit code 2.
const WAITING_FLAGS: [&str; 3] = ["--watch", "--strict", "--source-map"];

const HELP_ARGUMENTS: [&str; 3] = ["help", "--help", "-h"];

/// Runs one command line, `argv` being the arguments after the program name, and answers the exit
/// code: 0 when everything was written, 1 on a refusal or a compile error, 2 on a usage error.
///
/// An argument that is not UTF-8 is read with replacement characters, as Node reads it.
///
/// # Errors
///
/// [`CliError::NotPortedYet`] when the command reaches a stub, [`CliError::Internal`] on a bug.
pub fn run_command(argv: &[OsString], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let arguments: Vec<String> = argv
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();

    let Some((command_name, rest)) = arguments.split_first() else {
        return Ok(usage_error(io, "No command given."));
    };

    if HELP_ARGUMENTS.contains(&command_name.as_str()) {
        io.stdout(&usage_text());

        return Ok(EXIT_SUCCESS);
    }

    let waiting_flag = rest.iter().find(|argument| {
        let flag_name = argument
            .split_once('=')
            .map_or(argument.as_str(), |(name, _)| name);

        WAITING_FLAGS.contains(&flag_name)
    });

    if let Some(waiting_flag) = waiting_flag {
        return Ok(not_available(io, &format!("The flag '{waiting_flag}'")));
    }

    let Some(command) = Command::from_name(command_name) else {
        return Ok(usage_error(
            io,
            &format!("Unknown command '{command_name}'."),
        ));
    };

    // Each command lane replaces its arm with the port of its `run<Command>` function.
    match command {
        Command::Init => run_init(rest, io),
        Command::Compile => run_compile(rest, io),
        Command::Generate => Err(not_ported_yet("runGenerate")),
        Command::Check => Err(not_ported_yet("runCheck")),
        Command::Lint => run_lint(rest, io),
        Command::Diff => run_diff(rest, io),
        Command::Explain => run_explain(rest, io),
        Command::Bundle => run_bundle(rest, io),
    }
}

/// [`run_command`] as the binary runs it: a function not ported yet prints `cli.not-ported` and
/// exits with 2, a bug prints its message and exits with 1, as an uncaught error ends Node.
pub fn run_cli(argv: &[OsString], io: &mut dyn CliIo) -> i32 {
    match run_command(argv, io) {
        Ok(exit_code) => exit_code,
        Err(CliError::NotPortedYet { function }) => {
            let command = argv.first().map_or_else(String::new, |command| {
                command.to_string_lossy().into_owned()
            });

            print_problems(io, &[not_ported_problem(&command, function)]);

            EXIT_USAGE
        }
        Err(error) => {
            io.stderr(&format!("{error}\n"));

            EXIT_REFUSED
        }
    }
}

fn not_ported_problem(command: &str, function: &str) -> CliProblem {
    unlocated_problem(
        "cli.not-ported",
        format!("`seampact {command}` is not ported to this build yet ({function})."),
        &format!("Use the 1.x CLI for `{command}` until the generator layer lands."),
    )
}

fn run_compile(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let parsed = match parse_command_args(
        args,
        &[
            text_option("config"),
            text_option("out"),
            OptionSpec {
                name: "editor-schemas",
                kind: OptionKind::Flag,
            },
        ],
        Positionals::Refused,
    ) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };
    let outputs = CompileOutputs {
        ir_out_dir: parsed.text("out").map(str::to_owned),
        editor_schemas: if parsed.flag("editor-schemas") {
            EditorSchemasMode::Write
        } else {
            EditorSchemasMode::Skip
        },
    };

    compile_command(&config_location_of(&parsed, io), &outputs, io)
}

fn run_lint(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let parsed = match parse_command_args(args, &[text_option("config")], Positionals::Refused) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };

    lint_command(&config_location_of(&parsed, io), io)
}

fn run_diff(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let parsed = match parse_command_args(
        args,
        &[text_option("config"), text_option("against")],
        Positionals::Refused,
    ) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };

    let Some(against) = parsed.text("against") else {
        return Ok(usage_error(io, "`diff` needs `--against <path>`."));
    };

    diff_command(&config_location_of(&parsed, io), against, io)
}

/// A bare `--editor-schemas` asks for the default policy.
const EDITOR_SCHEMAS_FLAG: &str = "--editor-schemas";

fn run_init(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let with_policy: Vec<String> = args
        .iter()
        .map(|argument| {
            if argument == EDITOR_SCHEMAS_FLAG {
                format!(
                    "{EDITOR_SCHEMAS_FLAG}={}",
                    EditorSchemasPolicy::Ignore.as_str()
                )
            } else {
                argument.clone()
            }
        })
        .collect();
    let parsed = match parse_command_args(
        &with_policy,
        &[
            text_option("config"),
            flag_option("blank"),
            flag_option("modelines"),
            text_option("editor-schemas"),
            flag_option("no-modelines"),
            flag_option("no-ignore-files"),
        ],
        Positionals::Refused,
    ) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };
    let policy = parsed
        .text("editor-schemas")
        .unwrap_or(EditorSchemasPolicy::Ignore.as_str());
    let Some(editor_schemas) = EditorSchemasPolicy::ALL
        .into_iter()
        .find(|each| each.as_str() == policy)
    else {
        let policies: Vec<&str> = EditorSchemasPolicy::ALL
            .into_iter()
            .map(EditorSchemasPolicy::as_str)
            .collect();

        return Ok(usage_error(
            io,
            &format!(
                "`--editor-schemas` takes {}, not '{policy}'.",
                policies.join(", ")
            ),
        ));
    };
    let ignore_files = if parsed.flag("no-ignore-files") {
        InitWrite::Skip
    } else {
        InitWrite::Write
    };

    if parsed.flag("modelines") {
        if parsed.flag("blank") || parsed.flag("no-modelines") {
            return Ok(usage_error(
                io,
                "`init --modelines` writes no new project: drop `--blank` and `--no-modelines`.",
            ));
        }

        return init_command(
            &InitOptions::Modelines {
                location: config_location_of(&parsed, io),
                editor_schemas,
                ignore_files,
            },
            io,
        );
    }

    if parsed.text("config").is_some() {
        return Ok(usage_error(
            io,
            "`init` writes its config in the working directory; `--config` goes with `--modelines`.",
        ));
    }

    init_command(
        &InitOptions::NewProject {
            content: if parsed.flag("blank") {
                StarterContent::Blank
            } else {
                StarterContent::Example
            },
            editor_schemas,
            modelines: if parsed.flag("no-modelines") {
                InitWrite::Skip
            } else {
                InitWrite::Write
            },
            ignore_files,
        },
        io,
    )
}

fn run_explain(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let parsed = match parse_command_args(args, &[text_option("config")], Positionals::Allowed) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };

    let [operation] = parsed.positionals() else {
        return Ok(usage_error(
            io,
            "`explain` takes one operation, as `<api>.<operationId>`.",
        ));
    };

    explain_command(&config_location_of(&parsed, io), operation, io)
}

fn run_bundle(args: &[String], io: &mut dyn CliIo) -> Result<i32, CliError> {
    let parsed = match parse_command_args(
        args,
        &[
            text_option("config"),
            text_option("source"),
            text_option("out"),
            text_option("tarball"),
            text_option("npm-package"),
            text_option("name"),
            text_option("version"),
        ],
        Positionals::Refused,
    ) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(usage_error(io, error.message())),
    };
    let given: Vec<_> = BundleOutputFlag::ALL
        .into_iter()
        .filter_map(|flag| parsed.text(flag.as_str()).map(|path| flag.output(path)))
        .collect();

    let [output] = given.as_slice() else {
        return Ok(usage_error(
            io,
            "`bundle` needs exactly one of `--out`, `--tarball` and `--npm-package`.",
        ));
    };
    let options = BundleCommandOptions {
        output: output.clone(),
        contract: BundleNamedVersionOverride {
            name: parsed.text("name").map(str::to_owned),
            version: parsed.text("version").map(str::to_owned),
        },
        source: parsed.text("source").map(str::to_owned),
    };

    bundle_command(&config_location_of(&parsed, io), &options, io)
}

fn flag_option(name: &'static str) -> OptionSpec {
    OptionSpec {
        name,
        kind: OptionKind::Flag,
    }
}

fn text_option(name: &'static str) -> OptionSpec {
    OptionSpec {
        name,
        kind: OptionKind::Text,
    }
}

fn config_location_of(
    parsed: &ParsedArgs,
    io: &dyn CliIo,
) -> crate::config_location::ConfigLocation {
    config_location(io.cwd(), parsed.text("config"))
}

/// Prints a `cli.usage` problem and the usage text, and answers the usage exit code.
pub(crate) fn usage_error(io: &mut dyn CliIo, message: &str) -> i32 {
    let problem = unlocated_problem(
        "cli.usage",
        message.to_owned(),
        "Run `seampact help` for the commands and their options.",
    );

    print_problems(io, &[problem]);
    io.stderr(&usage_text());

    EXIT_USAGE
}

fn not_available(io: &mut dyn CliIo, subject: &str) -> i32 {
    let problem = unlocated_problem(
        "cli.not-available",
        format!("{subject} is not available yet."),
        &format!("Use {}.", listed(&quoted_commands())),
    );

    print_problems(io, &[problem]);

    EXIT_USAGE
}

fn usage_text() -> String {
    let lines: Vec<&str> = Command::ALL.iter().map(|command| command.usage()).collect();

    format!(
        "Usage: seampact <command> [options]\n\nCommands:\n{}\n",
        lines.join("\n")
    )
}

/// `seampact compile`, then the other names, each in backticks.
fn quoted_commands() -> Vec<String> {
    Command::ALL
        .iter()
        .map(|command| match command {
            Command::Compile => "`seampact compile`".to_owned(),
            other => format!("`{}`", other.as_str()),
        })
        .collect()
}

/// `a`, `b` or `c`.
fn listed(names: &[String]) -> String {
    match names.split_last() {
        Some((last, leading)) if !leading.is_empty() => format!("{} or {last}", leading.join(", ")),
        _ => names.concat(),
    }
}
