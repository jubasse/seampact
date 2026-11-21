//! The two entries of the CLI: [`run_command`] dispatches one command line, [`run_cli`] answers
//! a function not ported yet with `cli.not-ported`.

use std::ffi::OsString;

use seampact_cli_config::CliProblem;

use crate::command::Command;
use crate::not_ported::not_ported_yet;
use crate::{CliError, CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE, print_problems};

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
        Command::Init => Err(not_ported_yet("runInit")),
        Command::Compile => Err(not_ported_yet("runCompile")),
        Command::Generate => Err(not_ported_yet("runGenerate")),
        Command::Check => Err(not_ported_yet("runCheck")),
        Command::Lint => Err(not_ported_yet("runLint")),
        Command::Diff => Err(not_ported_yet("runDiff")),
        Command::Explain => Err(not_ported_yet("runExplain")),
        Command::Bundle => Err(not_ported_yet("runBundle")),
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
        Err(CliError::Internal(error)) => {
            io.stderr(&format!("{error}\n"));

            EXIT_REFUSED
        }
    }
}

fn not_ported_problem(command: &str, function: &str) -> CliProblem {
    CliProblem {
        code: "cli.not-ported".to_owned(),
        message: format!("`seampact {command}` is not ported to this build yet ({function})."),
        fix: format!("Use the 1.x CLI for `{command}` until the generator layer lands."),
        location: None,
        position: None,
        docs: None,
    }
}

/// Prints a `cli.usage` problem and the usage text, and answers the usage exit code.
pub(crate) fn usage_error(io: &mut dyn CliIo, message: &str) -> i32 {
    let problem = CliProblem {
        code: "cli.usage".to_owned(),
        message: message.to_owned(),
        fix: "Run `seampact help` for the commands and their options.".to_owned(),
        location: None,
        position: None,
        docs: None,
    };

    print_problems(io, &[problem]);
    io.stderr(&usage_text());

    EXIT_USAGE
}

fn not_available(io: &mut dyn CliIo, subject: &str) -> i32 {
    let problem = CliProblem {
        code: "cli.not-available".to_owned(),
        message: format!("{subject} is not available yet."),
        fix: format!("Use {}.", listed(&quoted_commands())),
        location: None,
        position: None,
        docs: None,
    };

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
