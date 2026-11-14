//! The identifier of a name in a language (ADR 0007 sections 4 and 5), and the canonical id of
//! ADR 0004 section 9.

use crate::{
    error::NamingError,
    reserved::{Language, is_reserved},
    roles::{Name, Role, Suffixes, assert_name, assert_segments, suffix_words},
};

/// The casing of an identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    /// `AssignTask`.
    Pascal,
    /// `assignTask`.
    Camel,
    /// `ASSIGN_TASK`.
    UpperSnake,
}

/// The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OperationIdCase {
    /// `listTasks`.
    #[default]
    Camel,
    /// `list_tasks`.
    Snake,
}

/// Where the reserved-word escape goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscapePosition {
    /// After the identifier.
    Suffix,
    /// Before the identifier.
    Prefix,
}

/// The reserved-word escape: its text and where it goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Escape {
    /// Suffix or prefix.
    pub position: EscapePosition,
    /// The text, `[A-Za-z0-9_]+`.
    pub text: String,
}

/// The options every target offers for its own language, applied after the shared algorithm.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IdentifierOptions {
    /// The suffix word of each derived role.
    pub suffixes: Option<Suffixes>,
    /// The reserved-word escape (default a trailing `_`).
    pub escape: Option<Escape>,
    /// The casing of enum members, where the language has them (default per language).
    pub enum_case: Option<Style>,
}

/// The options of [`canonical_id`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CanonicalIdOptions {
    /// The case of an operation id.
    pub operation_id_case: OperationIdCase,
}

const DEFAULT_ESCAPE_TEXT: &str = "_";

/// The style of `role` in `language` (ADR 0007 section 4 table), or `None` when the language has
/// no identifier for it: TypeScript enums are string literal unions.
#[must_use]
pub const fn style_of(role: Role, language: Language) -> Option<Style> {
    match role {
        Role::Operation | Role::Member => Some(Style::Camel),
        Role::EnumMember => match language {
            Language::TypeScript => None,
            Language::Php => Some(Style::Pascal),
            Language::Kotlin | Language::Java => Some(Style::UpperSnake),
        },
        Role::Schema
        | Role::Input
        | Role::Output
        | Role::Query
        | Role::Headers
        | Role::Path
        | Role::Response
        | Role::Params
        | Role::Error
        | Role::Errors
        | Role::Property
        | Role::Item
        | Role::Value
        | Role::Variant
        | Role::Endpoints => Some(Style::Pascal),
    }
}

fn capitalize(word: &str) -> String {
    let mut characters = word.chars();

    // Segments are `[a-z0-9]+`; a digit has no uppercase form and stays as it is.
    match characters.next() {
        Some(first) if first.is_ascii_lowercase() => {
            format!("{}{}", first.to_ascii_uppercase(), characters.as_str())
        }
        _ => word.to_owned(),
    }
}

fn join(words: &[String], style: Style) -> String {
    let mut out = String::new();

    for (index, word) in words.iter().enumerate() {
        match style {
            Style::UpperSnake => {
                if index > 0 {
                    out.push('_');
                }

                out.push_str(&word.to_uppercase());
            }
            Style::Camel if index == 0 => out.push_str(word),
            Style::Camel | Style::Pascal => out.push_str(&capitalize(word)),
        }
    }

    out
}

fn is_digit(character: Option<char>) -> bool {
    character.is_some_and(|found| found.is_ascii_digit())
}

fn escape_of(options: &IdentifierOptions) -> Result<Escape, NamingError> {
    let spec = options.escape.clone().unwrap_or_else(|| Escape {
        position: EscapePosition::Suffix,
        text: DEFAULT_ESCAPE_TEXT.to_owned(),
    });
    let well_formed = !spec.text.is_empty()
        && spec
            .text
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_');

    if !well_formed {
        return Err(NamingError::MalformedEscapeText(spec.text));
    }

    if spec.position == EscapePosition::Prefix && is_digit(spec.text.chars().next()) {
        return Err(NamingError::EscapePrefixStartsWithDigit);
    }

    Ok(spec)
}

/// The identifier of `name` in `language`.
///
/// The segments and the suffix words are joined in the style of the role, a leading `_` is added
/// when the first word starts with a digit, then the escape (a trailing `_` by default) when the
/// result is a reserved word, or, by role, a shadowed name. `None` when the language has no
/// identifier for the role (an enum member in TypeScript).
///
/// # Errors
///
/// A [`NamingError`], never a guess, on a malformed name: a segment outside `[a-z0-9]+`, a
/// missing or extra status, an empty result, or a malformed option.
pub fn identifier(
    name: &Name,
    language: Language,
    options: &IdentifierOptions,
) -> Result<Option<String>, NamingError> {
    assert_name(name)?;

    let Some(mut style) = style_of(name.role, language) else {
        return Ok(None);
    };

    if name.role == Role::EnumMember
        && let Some(enum_case) = options.enum_case
    {
        style = enum_case;
    }

    let spec = escape_of(options)?;
    let mut words = name.segments.clone();

    words.extend(suffix_words(name, options.suffixes.as_ref())?);

    if words.is_empty() {
        return Err(NamingError::NoSegment {
            role: name.role.as_str().to_owned(),
        });
    }

    let mut out = join(&words, style);

    if is_digit(out.chars().next()) {
        out = format!("_{out}");
    }

    if is_reserved(&out, language, name.role)? {
        out = match spec.position {
            EscapePosition::Prefix => format!("{}{out}", spec.text),
            EscapePosition::Suffix => format!("{out}{}", spec.text),
        };
    }

    Ok(Some(out))
}

/// The string of an operation id for `segments` under `conventions.operationIds.case`.
///
/// Pure casing, with no reserved-word escape and no digit escape, because the id is the same
/// string in the IR, in `OpenAPI` and in `relays`, and it is not a code identifier nor a
/// plain-object key (ADR 0007 section 3). The `order` is applied by the tree pass before.
///
/// # Errors
///
/// A [`NamingError`] for a malformed segment or no segment.
pub fn operation_id(segments: &[String], id_case: OperationIdCase) -> Result<String, NamingError> {
    assert_segments(segments)?;

    if segments.is_empty() {
        return Err(NamingError::EmptyOperationId);
    }

    match id_case {
        OperationIdCase::Snake => Ok(segments.join("_")),
        OperationIdCase::Camel => Ok(join(segments, Style::Camel)),
    }
}

/// The canonical id of ADR 0004 section 9 for a derived name.
///
/// The escaped `TypeScript` identifier of the name (`PascalCase` for a schema); an operation follows
/// `operation_id_case` instead. `None` for an enum member, which has no TypeScript form.
///
/// # Errors
///
/// A [`NamingError`] for a malformed name.
pub fn canonical_id(
    name: &Name,
    options: CanonicalIdOptions,
) -> Result<Option<String>, NamingError> {
    assert_name(name)?;

    if name.role == Role::Operation {
        return operation_id(&name.segments, options.operation_id_case).map(Some);
    }

    identifier(name, Language::TypeScript, &IdentifierOptions::default())
}
