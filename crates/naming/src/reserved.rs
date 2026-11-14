//! The reserved and shadowed names of each language (ADR 0007 section 5), read from the bundled
//! `reserved-words.json`.

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::OnceLock,
};

use serde::Deserialize;

use crate::{
    error::NamingError,
    roles::{Role, is_type_role},
};

const RESERVED_WORDS_JSON: &str =
    include_str!("../../../packages/core/spec/vectors/naming/reserved-words.json");

/// A target language the naming knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    /// TypeScript.
    TypeScript,
    /// Kotlin.
    Kotlin,
    /// Java.
    Java,
    /// PHP, whose reserved names compare case-insensitively.
    Php,
}

/// Every language, in the order the vectors name them.
pub const LANGUAGES: [Language; 4] = [
    Language::TypeScript,
    Language::Kotlin,
    Language::Java,
    Language::Php,
];

impl Language {
    /// The language as the vectors spell it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Kotlin => "kotlin",
            Self::Java => "java",
            Self::Php => "php",
        }
    }
}

impl FromStr for Language {
    type Err = NamingError;

    fn from_str(language: &str) -> Result<Self, NamingError> {
        assert_language(language)
    }
}

#[derive(Deserialize)]
struct RawFile {
    lists: HashMap<String, RawList>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawList {
    used_by: Vec<String>,
    case_insensitive: bool,
    keywords: Vec<String>,
    types: Vec<String>,
    members: Vec<String>,
    enum_members: Vec<String>,
}

struct Lists {
    case_insensitive: bool,
    keywords: HashSet<String>,
    types: HashSet<String>,
    members: HashSet<String>,
    enum_members: HashSet<String>,
}

type ListsByLanguage = HashMap<Language, Lists>;

// One entry per language this implementation names, read by its key; the list of another
// language (`python`) serves that language's own implementation and is not read here.
fn read_lists() -> Result<ListsByLanguage, NamingError> {
    let mut file: RawFile = serde_json::from_str(RESERVED_WORDS_JSON)
        .map_err(|error| NamingError::ReservedWords(error.to_string()))?;
    let mut lists = HashMap::new();

    for language in LANGUAGES {
        let name = language.as_str();
        let Some(raw) = file.lists.remove(name) else {
            return Err(NamingError::ReservedWords(format!("no list for {name}")));
        };

        if raw.used_by != [name] {
            return Err(NamingError::ReservedWords(format!(
                "the {name} list is used by {}",
                raw.used_by.join(", ")
            )));
        }

        lists.insert(
            language,
            Lists {
                case_insensitive: raw.case_insensitive,
                keywords: raw.keywords.into_iter().collect(),
                types: raw.types.into_iter().collect(),
                members: raw.members.into_iter().collect(),
                enum_members: raw.enum_members.into_iter().collect(),
            },
        );
    }

    Ok(lists)
}

fn list_of(language: Language) -> Result<&'static Lists, NamingError> {
    static LISTS: OnceLock<Result<ListsByLanguage, NamingError>> = OnceLock::new();

    let lists = LISTS
        .get_or_init(read_lists)
        .as_ref()
        .map_err(Clone::clone)?;

    lists
        .get(&language)
        .ok_or_else(|| NamingError::ReservedWords(format!("no list for {}", language.as_str())))
}

/// Whether `language` is one of the languages the naming knows.
#[must_use]
pub fn is_language(language: &str) -> bool {
    LANGUAGES.iter().any(|known| known.as_str() == language)
}

/// The language spelled `language`.
///
/// # Errors
///
/// [`NamingError::UnknownLanguage`] for a language this version does not know.
pub fn assert_language(language: &str) -> Result<Language, NamingError> {
    LANGUAGES
        .iter()
        .copied()
        .find(|known| known.as_str() == language)
        .ok_or_else(|| NamingError::UnknownLanguage(language.to_owned()))
}

/// Whether `identifier`, the final identifier of a name with `role`, collides in `language`.
///
/// The collision is with a keyword (every role); for a type role, a shadowed type name; for a
/// member or an operation, a name that breaks its class or record; for an enum member, a name its
/// enum cannot take. PHP compares case-insensitively.
///
/// # Errors
///
/// [`NamingError::ReservedWords`] when the bundled list file is malformed.
pub fn is_reserved(identifier: &str, language: Language, role: Role) -> Result<bool, NamingError> {
    let list = list_of(language)?;
    let key = if list.case_insensitive {
        identifier.to_lowercase()
    } else {
        identifier.to_owned()
    };

    if list.keywords.contains(&key) {
        return Ok(true);
    }

    if is_type_role(role) {
        return Ok(list.types.contains(&key));
    }

    match role {
        Role::Member | Role::Operation => Ok(list.members.contains(&key)),
        Role::EnumMember => Ok(list.enum_members.contains(&key)),
        _ => Ok(false),
    }
}
