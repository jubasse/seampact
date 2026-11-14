//! The slot spellings of a template: `$name`, `$name.path`, `${name.path}` inside a text.
//!
//! The TypeScript reads them with three anchored regular expressions over ASCII classes; each
//! reads left to right with no backtracking choice, so plain code gives the same matches.

/// A slot name and its member path as written.
pub(crate) struct SlotSpelling<'text> {
    /// The slot name, `[A-Za-z][A-Za-z0-9]*`.
    pub(crate) name: &'text str,
    /// The path as written: empty, or `.member` repeated.
    pub(crate) path: &'text str,
    /// What follows the spelling.
    pub(crate) remaining: &'text str,
}

fn split_prefix(text: &str, accepts: impl Fn(usize, char) -> bool) -> (&str, &str) {
    let length = text
        .char_indices()
        .find(|(index, character)| !accepts(*index, *character))
        .map_or(text.len(), |(index, _)| index);

    // Every accepted character is ASCII, so the length is a character boundary.
    text.split_at_checked(length).unwrap_or(("", text))
}

fn is_slot_name_character(index: usize, character: char) -> bool {
    if index == 0 {
        character.is_ascii_alphabetic()
    } else {
        character.is_ascii_alphanumeric()
    }
}

fn is_member_name_character(index: usize, character: char) -> bool {
    if index == 0 {
        character.is_ascii_alphabetic() || character == '_'
    } else {
        character.is_ascii_alphanumeric() || character == '_'
    }
}

// The longest run of `.member` groups; a `.` followed by no member ends it.
fn split_path(text: &str) -> (&str, &str) {
    let mut length = 0;
    let mut rest = text;

    while let Some(after_dot) = rest.strip_prefix('.') {
        let (member, remaining) = split_prefix(after_dot, is_member_name_character);

        if member.is_empty() {
            break;
        }

        length += 1 + member.len();
        rest = remaining;
    }

    text.split_at_checked(length).unwrap_or(("", text))
}

fn spelling_of(text: &str) -> Option<SlotSpelling<'_>> {
    let (name, after_name) = split_prefix(text, is_slot_name_character);

    if name.is_empty() {
        return None;
    }

    let (path, remaining) = split_path(after_name);

    Some(SlotSpelling {
        name,
        path,
        remaining,
    })
}

/// `$name` followed by a member path and nothing else.
pub(crate) fn whole_slot(value: &str) -> Option<SlotSpelling<'_>> {
    let spelling = spelling_of(value.strip_prefix('$')?)?;

    spelling.remaining.is_empty().then_some(spelling)
}

/// `{name.path}` after the `$` of a text slot; `remaining` follows the closing brace.
pub(crate) fn text_slot(after_dollar: &str) -> Option<SlotSpelling<'_>> {
    let spelling = spelling_of(after_dollar.strip_prefix('{')?)?;
    let remaining = spelling.remaining.strip_prefix('}')?;

    Some(SlotSpelling {
        remaining,
        ..spelling
    })
}

/// `$name` with no member path and nothing else: the slot name.
pub(crate) fn name_slot(value: &str) -> Option<&str> {
    let spelling = whole_slot(value)?;

    spelling.path.is_empty().then_some(spelling.name)
}

/// The member path of a slot as written: `""` is none, `.a.b` is `a`, `b`.
pub(crate) fn path_of(path: &str) -> Vec<String> {
    match path.strip_prefix('.') {
        Some(members) => members.split('.').map(str::to_owned).collect(),
        None => Vec::new(),
    }
}
