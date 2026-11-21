//! The strict subset of Node's `util.parseArgs` the commands use, with Node's messages.
//!
//! Option names are longer than one character and no option declares a short form, so every
//! short option (`-x`, `-xyz`) is unknown, as Node finds it.

use indexmap::IndexMap;

/// What an option takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OptionKind {
    /// A string value, `--name value` or `--name=value`; the last one wins.
    Text,
    /// A string value that may repeat, every value kept in order (`multiple: true`).
    TextList,
    /// No value (`type: "boolean"`).
    Flag,
}

/// One option a command declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OptionSpec {
    /// The name without its leading `--`.
    pub name: &'static str,
    /// What the option takes.
    pub kind: OptionKind,
}

/// Whether a command takes positional arguments besides its options (`allowPositionals`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Positionals {
    /// A positional argument is refused.
    Refused,
    /// Positional arguments are kept in order.
    Allowed,
}

/// The value one option was given.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum OptionValue {
    Text(String),
    TextList(Vec<String>),
    Flag,
}

/// The options and positionals of a command line Node's `parseArgs` accepted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedArgs {
    values: IndexMap<String, OptionValue>,
    positionals: Vec<String>,
}

impl ParsedArgs {
    /// The value of the text option `name`, when given.
    #[must_use]
    pub fn text(&self, name: &str) -> Option<&str> {
        match self.values.get(name) {
            Some(OptionValue::Text(value)) => Some(value),
            Some(OptionValue::TextList(_) | OptionValue::Flag) | None => None,
        }
    }

    /// Every value of the repeatable option `name`, in command-line order.
    #[must_use]
    pub fn texts(&self, name: &str) -> &[String] {
        match self.values.get(name) {
            Some(OptionValue::TextList(values)) => values,
            Some(OptionValue::Text(_) | OptionValue::Flag) | None => &[],
        }
    }

    /// Whether the flag `name` was given.
    #[must_use]
    pub fn flag(&self, name: &str) -> bool {
        matches!(self.values.get(name), Some(OptionValue::Flag))
    }

    /// The positional arguments, in order.
    #[must_use]
    pub fn positionals(&self) -> &[String] {
        &self.positionals
    }
}

/// Why Node's `parseArgs` refused a command line: its message, ending with a period as the CLI
/// prints it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct ParseArgsError {
    message: String,
}

impl ParseArgsError {
    fn new(node_message: &str) -> Self {
        let message = if node_message.ends_with('.') {
            node_message.to_owned()
        } else {
            format!("{node_message}.")
        };

        Self { message }
    }

    /// The message, as the usage error prints it.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// One option as Node's tokenizer reads it: its name, the text it was written as, and its value.
struct OptionToken<'args> {
    name: &'args str,
    raw_name: String,
    value: Option<&'args str>,
    inline_value: bool,
}

/// One token of the command line, in order.
enum Token<'args> {
    Option(OptionToken<'args>),
    Positional(&'args str),
}

/// Parses `args` against `options` as `parseArgs({ args, options, strict: true, allowPositionals })`
/// does; the tokens are checked in command-line order, so the first problem is the one reported.
///
/// # Errors
///
/// An unknown option, a text option without its value or given an option-like value as the next
/// argument, a flag given a value, or a positional argument a command refuses.
pub fn parse_command_args(
    args: &[String],
    options: &[OptionSpec],
    positionals: Positionals,
) -> Result<ParsedArgs, ParseArgsError> {
    let mut parsed = ParsedArgs::default();

    for token in tokens_of(args, options) {
        match token {
            Token::Positional(value) => {
                if positionals == Positionals::Refused {
                    return Err(ParseArgsError::new(&format!(
                        "Unexpected argument '{value}'. This command does not take positional arguments"
                    )));
                }

                parsed.positionals.push(value.to_owned());
            }
            Token::Option(option) => store_option(&mut parsed, &option, options, positionals)?,
        }
    }

    Ok(parsed)
}

fn tokens_of<'args>(args: &'args [String], options: &[OptionSpec]) -> Vec<Token<'args>> {
    let mut tokens = Vec::new();
    let mut remaining = args.iter();

    while let Some(arg) = remaining.next() {
        if arg == "--" {
            tokens.extend(
                remaining
                    .by_ref()
                    .map(|positional| Token::Positional(positional.as_str())),
            );

            break;
        }

        if let Some(after_dashes) = arg.strip_prefix("--") {
            tokens.push(long_option_token(
                arg,
                after_dashes,
                &mut remaining,
                options,
            ));

            continue;
        }

        let Some(short_options) = arg.strip_prefix('-').filter(|rest| !rest.is_empty()) else {
            tokens.push(Token::Positional(arg));

            continue;
        };

        // No option declares a short form: each letter of `-x` or `-xyz` is an unknown option.
        tokens.extend(short_options.char_indices().map(|(index, letter)| {
            let end = index + letter.len_utf8();

            Token::Option(OptionToken {
                name: short_options.get(index..end).unwrap_or_default(),
                raw_name: format!("-{letter}"),
                value: None,
                inline_value: false,
            })
        }));
    }

    tokens
}

/// `--name=value` when an `=` follows the first letter of the name, else `--name`, which takes
/// the next argument whatever it is when the option is a text option.
fn long_option_token<'args>(
    arg: &str,
    after_dashes: &'args str,
    remaining: &mut std::slice::Iter<'args, String>,
    options: &[OptionSpec],
) -> Token<'args> {
    let inline = after_dashes
        .char_indices()
        .skip(1)
        .find(|(_, character)| *character == '=')
        .map(|(index, _)| index);

    if let Some(equals_index) = inline {
        let name = after_dashes.get(..equals_index).unwrap_or_default();

        return Token::Option(OptionToken {
            name,
            raw_name: format!("--{name}"),
            value: after_dashes.get(equals_index + 1..),
            inline_value: true,
        });
    }

    let takes_text = matches!(
        spec_of(options, after_dashes).map(|spec| spec.kind),
        Some(OptionKind::Text | OptionKind::TextList)
    );
    let value = if takes_text {
        remaining.next().map(String::as_str)
    } else {
        None
    };

    Token::Option(OptionToken {
        name: after_dashes,
        raw_name: arg.to_owned(),
        value,
        inline_value: false,
    })
}

fn spec_of<'spec>(options: &'spec [OptionSpec], name: &str) -> Option<&'spec OptionSpec> {
    options.iter().find(|spec| spec.name == name)
}

fn store_option(
    parsed: &mut ParsedArgs,
    option: &OptionToken<'_>,
    options: &[OptionSpec],
    positionals: Positionals,
) -> Result<(), ParseArgsError> {
    let Some(spec) = spec_of(options, option.name) else {
        return Err(ParseArgsError::new(&unknown_option_message(
            &option.raw_name,
            positionals,
        )));
    };

    let name = option.name;

    match (spec.kind, option.value) {
        (OptionKind::Flag, Some(_)) => Err(ParseArgsError::new(&format!(
            "Option '--{name}' does not take an argument"
        ))),
        (OptionKind::Flag, None) => {
            parsed.values.insert(name.to_owned(), OptionValue::Flag);

            Ok(())
        }
        (OptionKind::Text | OptionKind::TextList, None) => Err(ParseArgsError::new(&format!(
            "Option '--{name} <value>' argument missing"
        ))),
        (OptionKind::Text | OptionKind::TextList, Some(value)) => {
            if !option.inline_value && is_option_like(value) {
                return Err(ParseArgsError::new(&format!(
                    "Option '--{name}' argument is ambiguous.\nDid you forget to specify the option argument for '--{name}'?\nTo specify an option argument starting with a dash use '--{name}=-XYZ'."
                )));
            }

            store_text(parsed, name, spec.kind, value);

            Ok(())
        }
    }
}

fn store_text(parsed: &mut ParsedArgs, name: &str, kind: OptionKind, value: &str) {
    if kind != OptionKind::TextList {
        parsed
            .values
            .insert(name.to_owned(), OptionValue::Text(value.to_owned()));

        return;
    }

    let entry = parsed
        .values
        .entry(name.to_owned())
        .or_insert_with(|| OptionValue::TextList(Vec::new()));

    if let OptionValue::TextList(values) = entry {
        values.push(value.to_owned());
    }
}

/// A value Node takes for a forgotten option argument: a dash and at least one more character.
fn is_option_like(value: &str) -> bool {
    value.len() > 1 && value.starts_with('-')
}

fn unknown_option_message(raw_name: &str, positionals: Positionals) -> String {
    match positionals {
        Positionals::Refused => format!("Unknown option '{raw_name}'"),
        Positionals::Allowed => format!(
            "Unknown option '{raw_name}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{raw_name}\""
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPTIONS: &[OptionSpec] = &[
        OptionSpec {
            name: "config",
            kind: OptionKind::Text,
        },
        OptionSpec {
            name: "force",
            kind: OptionKind::Flag,
        },
        OptionSpec {
            name: "bundle-directory",
            kind: OptionKind::TextList,
        },
    ];

    fn parse(args: &[&str], positionals: Positionals) -> Result<ParsedArgs, String> {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();

        parse_command_args(&args, OPTIONS, positionals).map_err(|error| error.message().to_owned())
    }

    // Each message is the one Node 24's `parseArgs` throws for the same command line, with the
    // period the CLI adds.
    #[test]
    fn refusals_carry_node_messages() {
        let cases: &[(&[&str], Positionals, &str)] = &[
            (
                &["--nope"],
                Positionals::Refused,
                "Unknown option '--nope'.",
            ),
            (
                &["--nope"],
                Positionals::Allowed,
                "Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--nope\".",
            ),
            (
                &["--config"],
                Positionals::Refused,
                "Option '--config <value>' argument missing.",
            ),
            (
                &["--config", "--force"],
                Positionals::Refused,
                "Option '--config' argument is ambiguous.\nDid you forget to specify the option argument for '--config'?\nTo specify an option argument starting with a dash use '--config=-XYZ'.",
            ),
            (
                &["--force=yes"],
                Positionals::Refused,
                "Option '--force' does not take an argument.",
            ),
            (
                &["stray"],
                Positionals::Refused,
                "Unexpected argument 'stray'. This command does not take positional arguments.",
            ),
            (
                &["--", "x"],
                Positionals::Refused,
                "Unexpected argument 'x'. This command does not take positional arguments.",
            ),
            (&["-x"], Positionals::Refused, "Unknown option '-x'."),
            (&["-fx"], Positionals::Refused, "Unknown option '-f'."),
            (&["--=x"], Positionals::Refused, "Unknown option '--=x'."),
            (
                &["--nope=3"],
                Positionals::Refused,
                "Unknown option '--nope'.",
            ),
        ];

        for (args, positionals, expected) in cases {
            assert_eq!(
                parse(args, *positionals),
                Err((*expected).to_owned()),
                "args {args:?}"
            );
        }
    }

    #[test]
    fn the_last_text_wins_and_lists_keep_every_value() {
        let parsed = parse(
            &[
                "--config=a",
                "--config",
                "b",
                "--bundle-directory",
                "x",
                "--bundle-directory=y",
                "--force",
                "--force",
            ],
            Positionals::Refused,
        )
        .unwrap();

        assert_eq!(parsed.text("config"), Some("b"));
        assert_eq!(parsed.texts("bundle-directory"), ["x", "y"]);
        assert!(parsed.flag("force"));
    }

    #[test]
    fn values_and_positionals_node_accepts() {
        assert_eq!(
            parse(&["--config", "-"], Positionals::Refused)
                .unwrap()
                .text("config"),
            Some("-")
        );
        assert_eq!(
            parse(&["--config="], Positionals::Refused)
                .unwrap()
                .text("config"),
            Some("")
        );
        assert_eq!(
            parse(&["-", "--", "--config"], Positionals::Allowed)
                .unwrap()
                .positionals(),
            ["-", "--config"]
        );
    }
}
