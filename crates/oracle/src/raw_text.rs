//! The text of a JSON file with the accepted differences taken out, so what is left can be held
//! to byte identity: layout, string escapes, number notation and member spelling included.

use std::collections::HashSet;

use seampact_json::escape_pointer;

use crate::{Mismatch, MismatchKind};

/// What stands in the text for a value that an intended difference accepts.
const ACCEPTED_VALUE_MARK: &str = "\u{0}";

/// The pointers of the accepted mismatches of one file, by what they accept.
#[derive(Debug, Default)]
pub(crate) struct AcceptedPointers {
    /// Scalars or values that differ: the value is replaced by a mark on both sides.
    pub(crate) values: HashSet<String>,
    /// Members or items on one side only: dropped with their key and layout.
    pub(crate) members: HashSet<String>,
}

impl AcceptedPointers {
    /// Notes the pointer of a mismatch an entry accepted.
    ///
    /// Entries accept only `Value`, `Added` and `Removed` mismatches; any other kind marks
    /// nothing, so its text stays compared byte for byte.
    pub(crate) fn note(&mut self, mismatch: &Mismatch) {
        let Some(pointer) = &mismatch.pointer else {
            return;
        };

        match mismatch.kind {
            MismatchKind::Value => self.values.insert(pointer.clone()),
            MismatchKind::Added | MismatchKind::Removed => self.members.insert(pointer.clone()),
            MismatchKind::MemberOrder | MismatchKind::Text | MismatchKind::Unparsable => false,
        };
    }

    /// Whether no mismatch was accepted.
    pub(crate) fn is_empty(&self) -> bool {
        self.values.is_empty() && self.members.is_empty()
    }
}

/// A scanned JSON text, scalars as written and every container with its layout.
enum RawNode<'text> {
    Scalar(&'text str),
    Container(RawContainer<'text>),
}

struct RawContainer<'text> {
    open: char,
    close: char,
    /// The whitespace of a container with no child.
    empty_layout: &'text str,
    children: Vec<RawChild<'text>>,
}

struct RawChild<'text> {
    /// The member name as written, quotes included; empty in an array.
    key: &'text str,
    /// The member name as a pointer segment; the index in an array.
    segment: String,
    /// Whitespace before the key or the value.
    before: &'text str,
    /// Whitespace, colon and whitespace between the key and the value.
    between: &'text str,
    value: RawNode<'text>,
    /// Whitespace after the value.
    after: &'text str,
}

/// Whether `expected_text` and `actual_text` are byte identical once the accepted values are
/// marked and the accepted members dropped on both sides.
///
/// Texts that cannot be scanned, or hold the same member name twice in one object, are not
/// identical: the file's layout cannot be vouched for.
pub(crate) fn identical_outside_accepted(
    expected_text: &str,
    actual_text: &str,
    accepted: &AcceptedPointers,
) -> bool {
    let (Some(expected), Some(actual)) = (scan(expected_text), scan(actual_text)) else {
        return false;
    };

    render(&expected, "", accepted) == render(&actual, "", accepted)
}

fn scan(text: &str) -> Option<RawNode<'_>> {
    let mut scanner = Scanner { rest: text };
    let node = scanner.node()?;

    scanner.skip_whitespace();

    scanner.rest.is_empty().then_some(node)
}

struct Scanner<'text> {
    rest: &'text str,
}

impl<'text> Scanner<'text> {
    fn skip_whitespace(&mut self) -> &'text str {
        let trimmed = self.rest.trim_start_matches([' ', '\t', '\n', '\r']);
        let skipped_length = self.rest.len() - trimmed.len();
        let (skipped, rest) = self.rest.split_at(skipped_length);

        self.rest = rest;

        skipped
    }

    fn node(&mut self) -> Option<RawNode<'text>> {
        self.skip_whitespace();

        match self.rest.chars().next()? {
            '{' => self.container('{', '}'),
            '[' => self.container('[', ']'),
            '"' => self.string_token().map(RawNode::Scalar),
            _ => self.bare_token().map(RawNode::Scalar),
        }
    }

    fn container(&mut self, open: char, close: char) -> Option<RawNode<'text>> {
        self.rest = self.rest.strip_prefix(open)?;

        let empty_layout = self.skip_whitespace();

        if let Some(rest) = self.rest.strip_prefix(close) {
            self.rest = rest;

            return Some(RawNode::Container(RawContainer {
                open,
                close,
                empty_layout,
                children: Vec::new(),
            }));
        }

        let mut children: Vec<RawChild<'text>> = Vec::new();
        let mut before = empty_layout;

        loop {
            let child = self.child(open, children.len(), before)?;

            if open == '{'
                && children
                    .iter()
                    .any(|sibling| sibling.segment == child.segment)
            {
                return None;
            }

            children.push(child);

            if let Some(rest) = self.rest.strip_prefix(close) {
                self.rest = rest;

                return Some(RawNode::Container(RawContainer {
                    open,
                    close,
                    empty_layout: "",
                    children,
                }));
            }

            self.rest = self.rest.strip_prefix(',')?;
            before = self.skip_whitespace();
        }
    }

    fn child(&mut self, open: char, index: usize, before: &'text str) -> Option<RawChild<'text>> {
        if open == '[' {
            let value = self.node()?;
            let after = self.skip_whitespace();

            return Some(RawChild {
                key: "",
                segment: index.to_string(),
                before,
                between: "",
                value,
                after,
            });
        }

        let key = self.string_token()?;
        let segment: String = serde_json::from_str(key).ok()?;
        let between_start = self.rest;

        self.skip_whitespace();
        self.rest = self.rest.strip_prefix(':')?;
        self.skip_whitespace();

        let between_length = between_start.len() - self.rest.len();
        let (between, _) = between_start.split_at(between_length);
        let value = self.node()?;
        let after = self.skip_whitespace();

        Some(RawChild {
            key,
            segment,
            before,
            between,
            value,
            after,
        })
    }

    /// A string token as written, quotes included.
    fn string_token(&mut self) -> Option<&'text str> {
        let mut escaped = false;

        for (offset, character) in self.rest.char_indices().skip(1) {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                let (token, rest) = self.rest.split_at(offset + 1);

                self.rest = rest;

                return Some(token);
            }
        }

        None
    }

    /// A number, `true`, `false` or `null` as written.
    fn bare_token(&mut self) -> Option<&'text str> {
        let end = self
            .rest
            .find(|character: char| {
                character == ','
                    || character == ']'
                    || character == '}'
                    || character.is_whitespace()
            })
            .unwrap_or(self.rest.len());
        let (token, rest) = self.rest.split_at(end);

        self.rest = rest;

        (!token.is_empty()).then_some(token)
    }
}

fn render(node: &RawNode<'_>, pointer: &str, accepted: &AcceptedPointers) -> String {
    if accepted.values.contains(pointer) {
        return ACCEPTED_VALUE_MARK.to_owned();
    }

    match node {
        RawNode::Scalar(token) => (*token).to_owned(),
        RawNode::Container(container) => render_container(container, pointer, accepted),
    }
}

fn render_container(
    container: &RawContainer<'_>,
    pointer: &str,
    accepted: &AcceptedPointers,
) -> String {
    let kept_children: Vec<String> = container
        .children
        .iter()
        .filter_map(|child| {
            let child_pointer = format!("{pointer}/{}", escape_pointer(&child.segment));

            if accepted.members.contains(&child_pointer) {
                return None;
            }

            Some(format!(
                "{}{}{}{}{}",
                child.before,
                child.key,
                child.between,
                render(&child.value, &child_pointer, accepted),
                child.after
            ))
        })
        .collect();

    let layout = if container.children.is_empty() {
        container.empty_layout
    } else {
        ""
    };

    format!(
        "{}{layout}{}{}",
        container.open,
        kept_children.join(","),
        container.close
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accepted(values: &[&str], members: &[&str]) -> AcceptedPointers {
        AcceptedPointers {
            values: values.iter().map(|pointer| (*pointer).to_owned()).collect(),
            members: members
                .iter()
                .map(|pointer| (*pointer).to_owned())
                .collect(),
        }
    }

    #[test]
    fn only_the_accepted_value_may_differ() {
        let none = AcceptedPointers::default();
        let one_value = accepted(&["/a"], &[]);

        assert!(identical_outside_accepted(
            "{\n  \"a\": 1,\n  \"b\": [2]\n}\n",
            "{\n  \"a\": 9,\n  \"b\": [2]\n}\n",
            &one_value
        ));
        assert!(!identical_outside_accepted(
            "{\n  \"a\": 1,\n  \"b\": [2]\n}\n",
            "{\n\t\"a\": 9,\n\t\"b\": [2]\n}\n",
            &one_value
        ));
        assert!(!identical_outside_accepted(
            "{\"a\": 1}",
            "{\"a\": 9}",
            &none
        ));
    }

    #[test]
    fn escapes_and_number_notation_outside_the_accepted_value_differ() {
        let one_value = accepted(&["/a"], &[]);

        assert!(!identical_outside_accepted(
            "{\"a\": 1, \"b\": \"x/y\"}",
            "{\"a\": 2, \"b\": \"x\\/y\"}",
            &one_value
        ));
        assert!(!identical_outside_accepted(
            "{\"a\": 1, \"b\": 1e21}",
            "{\"a\": 2, \"b\": 1E21}",
            &one_value
        ));
    }

    #[test]
    fn an_accepted_member_is_dropped_with_its_key_and_layout() {
        let expected = "{\n  \"a\": 1,\n  \"gone\": [\n    2\n  ],\n  \"b\": 3\n}\n";
        let actual = "{\n  \"a\": 1,\n  \"b\": 3\n}\n";

        assert!(identical_outside_accepted(
            expected,
            actual,
            &accepted(&[], &["/gone"])
        ));
        assert!(!identical_outside_accepted(
            expected,
            actual,
            &AcceptedPointers::default()
        ));
        assert!(identical_outside_accepted(
            "[1,\n 2]",
            "[1]",
            &accepted(&[], &["/1"])
        ));
        assert!(identical_outside_accepted(
            "{\"a\": 1}",
            "{}",
            &accepted(&[], &["/a"])
        ));
    }

    #[test]
    fn a_member_name_written_twice_is_not_identical() {
        assert!(!identical_outside_accepted(
            "{\"a\": 1, \"a\": 2}",
            "{\"a\": 1, \"a\": 2}",
            &AcceptedPointers::default()
        ));
    }
}
