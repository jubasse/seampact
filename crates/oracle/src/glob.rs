//! The two fixture globs: the command line's, which also matches below a path, and an entry's of
//! `differences.yaml`, which matches whole paths only.

/// One element of a command-line glob, matched against characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GlobToken {
    /// `**`: any characters, `/` included.
    AnyPath,
    /// `*`: any characters within one segment.
    AnyInSegment,
    /// `?`: one character other than `/`.
    OneCharacter,
    /// A character matched as itself.
    Literal(char),
}

/// The separator of path segments.
const SEGMENT_SEPARATOR: char = '/';

/// The glob of `cargo xtask oracle [<glob>]`: `**` any path, `*` one segment, `?` one character;
/// a glob also matches every path below what it matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureGlob {
    tokens: Vec<GlobToken>,
}

impl FixtureGlob {
    /// The glob of a command-line pattern.
    #[must_use]
    pub fn new(pattern: &str) -> Self {
        let mut tokens = Vec::new();
        let mut characters = pattern.chars().peekable();

        while let Some(character) = characters.next() {
            let token = match character {
                '*' if characters.next_if_eq(&'*').is_some() => GlobToken::AnyPath,
                '*' => GlobToken::AnyInSegment,
                '?' => GlobToken::OneCharacter,
                literal => GlobToken::Literal(literal),
            };

            tokens.push(token);
        }

        Self { tokens }
    }

    /// Whether `path` matches the glob, or lies below a path that does.
    #[must_use]
    pub fn matches(&self, path: &str) -> bool {
        let characters: Vec<char> = path.chars().collect();

        let segment_ends = characters
            .iter()
            .enumerate()
            .filter(|(_, character)| **character == SEGMENT_SEPARATOR)
            .map(|(position, _)| position)
            .chain([characters.len()]);

        segment_ends
            .filter_map(|end| characters.get(..end))
            .any(|prefix| tokens_match(&self.tokens, prefix))
    }
}

fn tokens_match(tokens: &[GlobToken], characters: &[char]) -> bool {
    let Some((first_token, other_tokens)) = tokens.split_first() else {
        return characters.is_empty();
    };

    match first_token {
        GlobToken::AnyPath => (0..=characters.len())
            .filter_map(|skipped| characters.get(skipped..))
            .any(|rest| tokens_match(other_tokens, rest)),
        GlobToken::AnyInSegment => {
            let segment_length = characters
                .iter()
                .position(|character| *character == SEGMENT_SEPARATOR)
                .unwrap_or(characters.len());

            (0..=segment_length)
                .filter_map(|skipped| characters.get(skipped..))
                .any(|rest| tokens_match(other_tokens, rest))
        }
        GlobToken::OneCharacter => match characters.split_first() {
            Some((character, rest)) if *character != SEGMENT_SEPARATOR => {
                tokens_match(other_tokens, rest)
            }
            _ => false,
        },
        GlobToken::Literal(literal) => match characters.split_first() {
            Some((character, rest)) if character == literal => tokens_match(other_tokens, rest),
            _ => false,
        },
    }
}

/// The segment of an entry glob that matches any number of segments.
const ANY_SEGMENTS: &str = "**";

/// Whether `path` matches an entry glob of `applies.fixtures` or `applies.path`: `*` within one
/// segment, `**` any number of segments (so `dir/**` matches `dir`), any other text that path only.
#[must_use]
pub fn entry_glob_matches(glob: &str, path: &str) -> bool {
    let glob_segments: Vec<&str> = glob.split(SEGMENT_SEPARATOR).collect();
    let path_segments: Vec<&str> = path.split(SEGMENT_SEPARATOR).collect();

    segments_match(&glob_segments, &path_segments)
}

fn segments_match(glob_segments: &[&str], path_segments: &[&str]) -> bool {
    let Some((first_glob, other_globs)) = glob_segments.split_first() else {
        return path_segments.is_empty();
    };

    if *first_glob == ANY_SEGMENTS {
        return (0..=path_segments.len())
            .filter_map(|skipped| path_segments.get(skipped..))
            .any(|rest| segments_match(other_globs, rest));
    }

    match path_segments.split_first() {
        Some((first_path, other_paths)) => {
            segment_matches(first_glob, first_path) && segments_match(other_globs, other_paths)
        }
        None => false,
    }
}

/// Whether one path segment matches one glob segment, `*` matching any characters.
fn segment_matches(glob_segment: &str, path_segment: &str) -> bool {
    let tokens: Vec<GlobToken> = glob_segment
        .chars()
        .map(|character| match character {
            '*' => GlobToken::AnyInSegment,
            literal => GlobToken::Literal(literal),
        })
        .collect();
    let characters: Vec<char> = path_segment.chars().collect();

    tokens_match(&tokens, &characters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_line_glob_matches_its_paths_and_what_is_below_them() {
        let glob = FixtureGlob::new("golden/*");

        assert!(glob.matches("golden/tasks"));
        assert!(glob.matches("golden/tasks/nested"));
        assert!(!glob.matches("golden"));
        assert!(!glob.matches("goldenrod/tasks"));
        assert!(FixtureGlob::new("big").matches("big/above"));
        assert!(!FixtureGlob::new("big").matches("bigger"));
        assert!(FixtureGlob::new("**/tasks").matches("a/b/tasks"));
        assert!(FixtureGlob::new("t?sks").matches("tasks"));
        assert!(!FixtureGlob::new("a?b").matches("a/b"));
    }

    #[test]
    fn an_entry_glob_matches_whole_paths_and_a_trailing_double_star_matches_the_directory() {
        assert!(entry_glob_matches("big-integers/**", "big-integers"));
        assert!(entry_glob_matches(
            "big-integers/**",
            "big-integers/above/deep"
        ));
        assert!(!entry_glob_matches("big-integers", "big-integers/above"));
        assert!(entry_glob_matches("a/**/b", "a/b"));
        assert!(entry_glob_matches("a/**/b", "a/x/y/b"));
        assert!(entry_glob_matches("a/*-x", "a/b-x"));
        assert!(!entry_glob_matches("a/*", "a/b/c"));
    }
}
