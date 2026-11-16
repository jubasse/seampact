//! The portable regular expressions: a written pattern is parsed against the kept subset and stored
//! with its normalised form, in ECMAScript `u` syntax with every engine-dependent construct spelled
//! out: `.` and the shorthands become explicit ASCII classes, and a class becomes its sorted, merged
//! code point ranges. Two shapes that backtrack exponentially are refused too: a repeated group whose
//! tail repetition of variable count can match what the group starts with, and a repeated
//! alternation whose branches can start with the same character.

use seampact_diagnostics::InternalError;
use seampact_js::js_number_of_text;
use seampact_pipeline::PassError;

/// The result of normalising a pattern: its normalised form, or why it is refused and how to fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeSchemasPatternResult {
    /// The pattern is portable; its normalised form.
    Normalized {
        /// The normalised pattern.
        normalized: String,
    },
    /// The pattern is refused.
    Refused {
        /// Why it is refused.
        message: String,
        /// How the author fixes it.
        fix: String,
    },
}

/// A range of code points, both ends included.
type Range = (u32, u32);

const MAX_CODE_POINT: u32 = 0x0010_ffff;

/// RE2 refuses a repetition count above 1000, so a portable pattern stays within it.
const MAX_REPEAT: u32 = 1000;

/// The parser recurses once per group: deeper nesting is refused before it exhausts the stack.
const MAX_GROUP_DEPTH: usize = 100;

/// What a malformed `{` says.
const REPETITION_SYNTAX: &str =
    "a '{' starts a repetition '{n}', '{n,}' or '{n,m}'; escape a literal '{'";

/// The characters ADR 0003 section 9 lets a pattern escape.
const METACHARACTERS: &str = "\\^$.|?*+()[]{}/";

const DIGITS: [Range; 1] = [(0x30, 0x39)];

const WORD: [Range; 4] = [(0x30, 0x39), (0x41, 0x5a), (0x5f, 0x5f), (0x61, 0x7a)];

/// `\t \n \v \f \r` and the space: ASCII only, as ADR 0003 section 9 fixes it.
const SPACE: [Range; 2] = [(0x09, 0x0d), (0x20, 0x20)];

/// What `.` never matches: `\n`, `\r`, U+0085, U+2028 and U+2029.
const LINE_ENDS: [Range; 4] = [(0x0a, 0x0a), (0x0d, 0x0d), (0x85, 0x85), (0x2028, 0x2029)];

/// The shorthand classes and the ranges each stands for.
const SHORTHANDS: [(char, &[Range]); 3] = [('d', &DIGITS), ('w', &WORD), ('s', &SPACE)];

/// The ranges of the shorthand class named by its lower-case letter.
fn shorthand_ranges(letter: char) -> Option<&'static [Range]> {
    SHORTHANDS
        .iter()
        .find(|(name, _)| *name == letter)
        .map(|(_, ranges)| *ranges)
}

const PORTABLE_FIX: &str = "rewrite it in the portable subset of ADR 0003 section 9";

const BACKTRACKING_FIX: &str = "rewrite it so no repeated group holds a repetition of variable count or branches that start with the same character, or check that text in the application's code (A45)";

/// What the parser throws when a pattern is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PatternRefusal {
    message: String,
    fix: String,
}

/// What the backtracking checks know of a parsed fragment besides its normalised text: the code
/// points it can start and end with, the characters of each repetition of variable count still in its
/// tail, whether it can match the empty string, and whether one pass of it can be an alternation whose
/// two branches start with the same code point.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fragment {
    text: String,
    first: Vec<Range>,
    last: Vec<Range>,
    varying_tails: Vec<Vec<Range>>,
    nullable: bool,
    overlapping: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Atom {
    fragment: Fragment,
    repeatable: bool,
}

/// A quantifier as written: its normalised text and its bounds, `max` `None` when unbounded.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Repetition {
    text: String,
    min: u32,
    max: Option<u32>,
}

/// One item of a sequence: an atom and the quantifier written after it, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SequenceItem {
    atom: Atom,
    repetition: Option<Repetition>,
}

const ONCE: u32 = 1;

/// The characters a class escapes.
const CLASS_SYNTAX: &str = "\\]-[^";

/// A single-character atom: its normalised text and the code points it matches.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Matched {
    text: String,
    ranges: Vec<Range>,
}

/// The bounds a one-character quantifier stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SymbolBound {
    symbol: char,
    min: u32,
    max: Option<u32>,
}

const SYMBOL_BOUNDS: [SymbolBound; 3] = [
    SymbolBound {
        symbol: '*',
        min: 0,
        max: None,
    },
    SymbolBound {
        symbol: '+',
        min: 1,
        max: None,
    },
    SymbolBound {
        symbol: '?',
        min: 0,
        max: Some(1),
    },
];

/// Escapes every character ADR 0003 section 9 lets a pattern escape, so `text` matches itself
/// literally.
#[must_use]
pub fn tree_schemas_escape_pattern_literal(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());

    for character in text.chars() {
        if METACHARACTERS.contains(character) {
            escaped.push('\\');
        }

        escaped.push(character);
    }

    escaped
}

impl PatternRefusal {
    const fn new(message: String, fix: String) -> Self {
        Self { message, fix }
    }
}

/// Why a parser step stopped: the pattern is refused (the TypeScript throw), or the half hit a bug.
#[derive(Debug)]
enum PatternFailure {
    Refused(PatternRefusal),
    Pass(PassError),
}

impl From<PassError> for PatternFailure {
    fn from(error: PassError) -> Self {
        Self::Pass(error)
    }
}

fn refuse<Never>(reason: &str) -> Result<Never, PatternFailure> {
    Err(PatternFailure::Refused(PatternRefusal::new(
        format!("the pattern is not portable: {reason}"),
        PORTABLE_FIX.to_owned(),
    )))
}

fn refuse_backtracking<Never>(reason: &str) -> Result<Never, PatternFailure> {
    Err(PatternFailure::Refused(PatternRefusal::new(
        format!("the pattern can backtrack exponentially: {reason}"),
        BACKTRACKING_FIX.to_owned(),
    )))
}

fn overlaps(left: &[Range], right: &[Range]) -> bool {
    left.iter().any(|&(left_start, left_end)| {
        right
            .iter()
            .any(|&(right_start, right_end)| left_start <= right_end && right_start <= left_end)
    })
}

fn any_two_overlap(sets: &[&[Range]]) -> bool {
    sets.iter().enumerate().any(|(index, set)| {
        sets.iter()
            .skip(index + 1)
            .any(|other| overlaps(set, other))
    })
}

fn runs_at_most_once(repetition: Option<&Repetition>) -> bool {
    repetition.is_none_or(|repetition| repetition.max.is_some_and(|max| max <= ONCE))
}

fn is_optional(item: &SequenceItem) -> bool {
    item.atom.fragment.nullable
        || item
            .repetition
            .as_ref()
            .is_some_and(|written| written.min == 0)
}

fn varies(repetition: Option<&Repetition>) -> bool {
    repetition.is_some_and(|written| Some(written.min) != written.max)
}

/// A repetition that can run more than once must not wrap a fragment that can split one text
/// several ways: one whose trailing repetition can go on into the next pass, or whose branches can
/// start alike.
fn refuse_exponential_repetition(
    atom: &Atom,
    repetition: &Repetition,
) -> Result<(), PatternFailure> {
    if repetition.max.is_some_and(|max| max <= ONCE) {
        return Ok(());
    }

    let fragment = &atom.fragment;

    if fragment
        .varying_tails
        .iter()
        .any(|tail| overlaps(tail, &fragment.first))
    {
        return refuse_backtracking(&format!(
            "'{}{}' repeats a group whose trailing repetition can match what the group starts with",
            fragment.text, repetition.text
        ));
    }

    if fragment.overlapping {
        return refuse_backtracking(&format!(
            "'{}{}' repeats an alternation whose branches can start with the same character",
            fragment.text, repetition.text
        ));
    }

    Ok(())
}

/// The ranges sorted and joined where they touch or overlap.
fn merged(ranges: &[Range]) -> Vec<Range> {
    let mut sorted = ranges.to_vec();

    sorted.sort_by_key(|&(start, _)| start);

    let mut joined: Vec<Range> = Vec::with_capacity(sorted.len());

    for (start, end) in sorted {
        match joined.last_mut() {
            Some(last) if start <= last.1.saturating_add(1) => last.1 = last.1.max(end),
            _ => joined.push((start, end)),
        }
    }

    joined
}

/// Every code point the ranges leave out.
fn complement(ranges: &[Range]) -> Vec<Range> {
    let mut left_out: Vec<Range> = Vec::new();
    let mut next: u32 = 0;

    for (start, end) in merged(ranges) {
        if start > next {
            left_out.push((next, start - 1));
        }

        next = end.saturating_add(1);
    }

    if next <= MAX_CODE_POINT {
        left_out.push((next, MAX_CODE_POINT));
    }

    left_out
}

/// Four digits at least, upper case.
fn hex(code_point: u32) -> String {
    format!("{code_point:04X}")
}

const fn is_invisible(code_point: u32) -> bool {
    code_point < 0x20
        || (code_point >= 0x7f && code_point <= 0xa0)
        || code_point == 0x2028
        || code_point == 0x2029
}

/// A code point as text: astral and invisible ones as `\u` escapes, the characters `syntax` names
/// escaped.
fn code_point_text(code_point: u32, syntax: &str) -> Result<String, PassError> {
    if code_point > 0xffff {
        return Ok(format!("\\u{{{}}}", hex(code_point)));
    }

    if is_invisible(code_point) {
        return Ok(format!("\\u{}", hex(code_point)));
    }

    let Some(character) = char::from_u32(code_point) else {
        return Err(PassError::from(InternalError::new(format!(
            "code point {code_point:#x} is not a character"
        ))));
    };

    if syntax.contains(character) {
        return Ok(format!("\\{character}"));
    }

    Ok(character.to_string())
}

fn class_text(ranges: &[Range], negated: bool) -> Result<String, PassError> {
    let text = |code_point: u32| code_point_text(code_point, CLASS_SYNTAX);
    let mut body = String::new();

    for (start, end) in merged(ranges) {
        body.push_str(&text(start)?);

        if start != end {
            body.push('-');
            body.push_str(&text(end)?);
        }
    }

    Ok(format!("[{}{body}]", if negated { "^" } else { "" }))
}

fn literal(code_point: u32, syntax: &str) -> Result<Matched, PassError> {
    Ok(Matched {
        text: code_point_text(code_point, syntax)?,
        ranges: vec![(code_point, code_point)],
    })
}

fn matching(matched: Matched) -> Atom {
    Atom {
        fragment: Fragment {
            text: matched.text,
            first: matched.ranges.clone(),
            last: matched.ranges,
            varying_tails: Vec::new(),
            nullable: false,
            overlapping: false,
        },
        repeatable: true,
    }
}

/// A recursive-descent parser over the code points of one pattern.
#[derive(Debug)]
struct PatternParser {
    chars: Vec<char>,
    at: usize,
    group_depth: usize,
}

impl PatternParser {
    const fn new(chars: Vec<char>) -> Self {
        Self {
            chars,
            at: 0,
            group_depth: 0,
        }
    }

    fn parse(&mut self) -> Result<String, PatternFailure> {
        let Fragment { text, .. } = self.alternation()?;

        if let Some(unexpected) = self.peek(0) {
            return refuse(&format!("'{unexpected}' is not expected here; escape it"));
        }

        Ok(text)
    }

    fn peek(&self, offset: usize) -> Option<char> {
        self.chars.get(self.at + offset).copied()
    }

    fn next(&mut self) -> Result<char, PatternFailure> {
        let character = self.chars.get(self.at).copied();

        self.at += 1;

        match character {
            Some(character) => Ok(character),
            None => refuse("the pattern ends inside a construct"),
        }
    }

    fn alternation(&mut self) -> Result<Fragment, PatternFailure> {
        let mut branches = vec![self.sequence()?];

        while self.peek(0) == Some('|') {
            self.at += 1;
            branches.push(self.sequence()?);
        }

        let firsts: Vec<&[Range]> = branches
            .iter()
            .map(|branch| branch.first.as_slice())
            .collect();
        let overlapping =
            any_two_overlap(&firsts) || branches.iter().any(|branch| branch.overlapping);
        let texts: Vec<&str> = branches.iter().map(|branch| branch.text.as_str()).collect();

        Ok(Fragment {
            text: texts.join("|"),
            first: branches
                .iter()
                .flat_map(|branch| branch.first.clone())
                .collect(),
            last: branches
                .iter()
                .flat_map(|branch| branch.last.clone())
                .collect(),
            varying_tails: branches
                .iter()
                .flat_map(|branch| branch.varying_tails.clone())
                .collect(),
            nullable: branches.iter().any(|branch| branch.nullable),
            overlapping,
        })
    }

    fn sequence(&mut self) -> Result<Fragment, PatternFailure> {
        let mut text = String::new();
        let mut first: Vec<Range> = Vec::new();
        let mut last: Vec<Range> = Vec::new();
        let mut varying_tails: Vec<Vec<Range>> = Vec::new();
        let mut nullable = true;
        let mut items: Vec<SequenceItem> = Vec::new();

        while self
            .peek(0)
            .is_some_and(|character| character != '|' && character != ')')
        {
            let atom = self.atom()?;
            let repetition = if atom.repeatable {
                self.quantifier()?
            } else {
                self.no_quantifier()?
            };

            if let Some(repetition) = &repetition {
                refuse_exponential_repetition(&atom, repetition)?;
            }

            text.push_str(&atom.fragment.text);

            if let Some(repetition) = &repetition {
                text.push_str(&repetition.text);
            }

            let item = SequenceItem { atom, repetition };

            // An optional item keeps what the items before it can end with; a required one replaces
            // it, but a repetition whose characters overlap the required item stays in the tail,
            // since it can match that item too.
            let optional = is_optional(&item);
            let item_tails: Vec<Vec<Range>> = if varies(item.repetition.as_ref()) {
                let mut tails = vec![item.atom.fragment.last.clone()];

                tails.extend(item.atom.fragment.varying_tails.iter().cloned());
                tails
            } else {
                item.atom.fragment.varying_tails.clone()
            };
            let mut kept_tails: Vec<Vec<Range>> = if optional {
                varying_tails
            } else {
                varying_tails
                    .into_iter()
                    .filter(|tail| overlaps(tail, &item.atom.fragment.first))
                    .collect()
            };

            if nullable {
                first.extend(item.atom.fragment.first.iter().copied());
            }

            if optional {
                last.extend(item.atom.fragment.last.iter().copied());
            } else {
                last.clone_from(&item.atom.fragment.last);
            }

            kept_tails.extend(item_tails);
            varying_tails = kept_tails;
            nullable = nullable && optional;
            items.push(item);
        }

        // An item run at most once shows its overlap when every other item is optional, since one
        // pass can then be that item alone: `((a|ab))*` and `((a|aa)b?)*` both repeat `(a|aa)`.
        let overlapping = items.iter().enumerate().any(|(index, item)| {
            item.atom.fragment.overlapping
                && runs_at_most_once(item.repetition.as_ref())
                && items
                    .iter()
                    .enumerate()
                    .all(|(other_index, other)| other_index == index || is_optional(other))
        });

        Ok(Fragment {
            text,
            first,
            last,
            varying_tails,
            nullable,
            overlapping,
        })
    }

    fn atom(&mut self) -> Result<Atom, PatternFailure> {
        let character = self.next()?;

        match character {
            '(' => Ok(Atom {
                fragment: self.group()?,
                repeatable: true,
            }),
            '[' => Ok(matching(self.character_class()?)),
            '.' => Ok(matching(Matched {
                text: class_text(&LINE_ENDS, true)?,
                ranges: complement(&LINE_ENDS),
            })),
            '^' | '$' => Ok(Atom {
                fragment: Fragment {
                    text: character.to_string(),
                    first: Vec::new(),
                    last: Vec::new(),
                    varying_tails: Vec::new(),
                    nullable: true,
                    overlapping: false,
                },
                repeatable: false,
            }),
            '\\' => Ok(matching(self.escape()?)),
            '*' | '+' | '?' => refuse(&format!("'{character}' has nothing to repeat")),
            '{' | '}' | ']' => refuse(&format!(
                "a literal '{character}' must be escaped ('\\{character}')"
            )),
            _ => Ok(matching(literal(u32::from(character), METACHARACTERS)?)),
        }
    }

    fn group(&mut self) -> Result<Fragment, PatternFailure> {
        let mut open = "(";

        if self.peek(0) == Some('?') {
            if self.peek(1) != Some(':') {
                return refuse(
                    "lookarounds, named groups and inline flags are not portable; use '(?:' or '('",
                );
            }

            self.at += 2;
            open = "(?:";
        }

        self.group_depth += 1;

        if self.group_depth > MAX_GROUP_DEPTH {
            return refuse(&format!(
                "groups nested more than {MAX_GROUP_DEPTH} deep are not portable"
            ));
        }

        let inner = self.alternation()?;

        if self.next()? != ')' {
            return refuse("a group is not closed");
        }

        self.group_depth -= 1;

        Ok(Fragment {
            text: format!("{open}{})", inner.text),
            ..inner
        })
    }

    fn escape(&mut self) -> Result<Matched, PatternFailure> {
        let character = self.next()?;
        let lowered = character.to_ascii_lowercase();

        if let Some(shorthand) = shorthand_ranges(lowered) {
            let negated = character != lowered;

            return Ok(Matched {
                text: class_text(shorthand, negated)?,
                ranges: if negated {
                    complement(shorthand)
                } else {
                    shorthand.to_vec()
                },
            });
        }

        if METACHARACTERS.contains(character) {
            return Ok(literal(u32::from(character), METACHARACTERS)?);
        }

        refuse(&format!(
            "'\\{character}' is not portable; only a metacharacter may be escaped"
        ))
    }

    fn no_quantifier(&mut self) -> Result<Option<Repetition>, PatternFailure> {
        if let Some(character) = self.peek(0)
            && matches!(character, '*' | '+' | '?' | '{')
        {
            return refuse(&format!("'{character}' cannot repeat an anchor"));
        }

        Ok(None)
    }

    fn quantifier(&mut self) -> Result<Option<Repetition>, PatternFailure> {
        let repetition = self.written_quantifier()?;
        let after = self.peek(0);

        if repetition.is_some() && matches!(after, Some('?' | '+')) {
            return refuse("lazy and possessive quantifiers are not portable; use the greedy form");
        }

        Ok(repetition)
    }

    fn written_quantifier(&mut self) -> Result<Option<Repetition>, PatternFailure> {
        let Some(character) = self.peek(0) else {
            return Ok(None);
        };

        if character == '{' {
            self.at += 1;

            return Ok(Some(self.counted()?));
        }

        let Some(bounds) = SYMBOL_BOUNDS
            .iter()
            .find(|bounds| bounds.symbol == character)
        else {
            return Ok(None);
        };

        self.at += 1;

        Ok(Some(Repetition {
            text: character.to_string(),
            min: bounds.min,
            max: bounds.max,
        }))
    }

    fn counted(&mut self) -> Result<Repetition, PatternFailure> {
        let min = self.count()?;
        let mut max = Some(min);

        if self.peek(0) == Some(',') {
            self.at += 1;
            max = if self.peek(0) == Some('}') {
                None
            } else {
                Some(self.count()?)
            };
        }

        if self.next()? != '}' {
            return refuse(REPETITION_SYNTAX);
        }

        if let Some(max) = max
            && max < min
        {
            return refuse(&format!(
                "the repetition {{{min},{max}}} has its bounds reversed"
            ));
        }

        let text = match max {
            Some(max) if max == min => format!("{{{min}}}"),
            Some(max) => format!("{{{min},{max}}}"),
            None => format!("{{{min},}}"),
        };

        Ok(Repetition { text, min, max })
    }

    fn count(&mut self) -> Result<u32, PatternFailure> {
        let mut digits = String::new();

        while let Some(digit) = self.peek(0).filter(char::is_ascii_digit) {
            digits.push(digit);
            self.at += 1;
        }

        if digits.is_empty() {
            return refuse(REPETITION_SYNTAX);
        }

        let count = js_number_of_text(&digits);

        if count > f64::from(MAX_REPEAT) {
            return refuse(&format!(
                "a repetition count above {MAX_REPEAT} is not portable"
            ));
        }

        // Within 0..=MAX_REPEAT, so the digits parse as a u32.
        digits.parse::<u32>().map_err(|error| {
            PatternFailure::Pass(PassError::from(InternalError::new(format!(
                "tree.schemas reads the repetition count {digits:?}, which is no u32: {error}"
            ))))
        })
    }

    fn character_class(&mut self) -> Result<Matched, PatternFailure> {
        let negated = self.peek(0) == Some('^');

        if negated {
            self.at += 1;
        }

        let mut ranges: Vec<Range> = Vec::new();
        let first = self.at;

        while self.peek(0) != Some(']') {
            let at_first = self.at == first;
            let Some(start) = self.class_item(&mut ranges, at_first)? else {
                continue;
            };

            if self.peek(0) == Some('-') && self.peek(1) != Some(']') {
                self.at += 1;

                let Some(end) = self.class_item(&mut ranges, false)? else {
                    return refuse("a range in a class ends with a shorthand");
                };

                if end < start {
                    return refuse("a range in a class has its bounds reversed");
                }

                ranges.push((start, end));
            } else {
                ranges.push((start, start));
            }
        }

        self.at += 1;

        if self.at - 1 == first {
            return refuse("an empty class matches nothing");
        }

        Ok(Matched {
            text: class_text(&ranges, negated)?,
            ranges: if negated { complement(&ranges) } else { ranges },
        })
    }

    /// One class member: a code point, or `None` for a shorthand whose ranges it added to `ranges`.
    fn class_item(
        &mut self,
        ranges: &mut Vec<Range>,
        first: bool,
    ) -> Result<Option<u32>, PatternFailure> {
        let character = self.next()?;

        if character == '-' && !first && self.peek(0) != Some(']') {
            return refuse(
                "a literal '-' inside a class must be escaped unless it is first or last",
            );
        }

        if character == '{' || character == '}' {
            return refuse(&format!(
                "a literal '{character}' must be escaped ('\\{character}')"
            ));
        }

        if character != '\\' {
            return Ok(Some(u32::from(character)));
        }

        let escaped = self.next()?;
        let lowered = escaped.to_ascii_lowercase();

        if let Some(shorthand) = shorthand_ranges(lowered) {
            if escaped == lowered {
                ranges.extend_from_slice(shorthand);
            } else {
                ranges.extend(complement(shorthand));
            }

            return Ok(None);
        }

        if METACHARACTERS.contains(escaped) || escaped == '-' {
            return Ok(Some(u32::from(escaped)));
        }

        refuse(&format!(
            "'\\{escaped}' is not portable; only a metacharacter or '-' may be escaped"
        ))
    }
}

/// Parses `source` against the portable subset and answers its normalised form, or why it is refused.
///
/// # Errors
///
/// An internal error for a bug of the parser; a refusal is an answer
/// ([`TreeSchemasPatternResult::Refused`]), not an error.
pub fn tree_schemas_normalize_pattern(source: &str) -> Result<TreeSchemasPatternResult, PassError> {
    let mut parser = PatternParser::new(source.chars().collect());

    match parser.parse() {
        Ok(normalized) => Ok(TreeSchemasPatternResult::Normalized { normalized }),
        Err(PatternFailure::Refused(PatternRefusal { message, fix })) => {
            Ok(TreeSchemasPatternResult::Refused { message, fix })
        }
        Err(PatternFailure::Pass(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized(source: &str) -> String {
        match tree_schemas_normalize_pattern(source) {
            Ok(TreeSchemasPatternResult::Normalized { normalized }) => normalized,
            other => panic!("pattern {source:?} gave {other:?}"),
        }
    }

    fn refusal(source: &str) -> String {
        match tree_schemas_normalize_pattern(source) {
            Ok(TreeSchemasPatternResult::Refused { message, .. }) => message,
            other => panic!("pattern {source:?} gave {other:?}"),
        }
    }

    #[test]
    fn shorthands_and_classes_become_sorted_merged_ranges() {
        let cases = [
            (r"\d", "[0-9]"),
            (r"\D", "[^0-9]"),
            (r"[\wa]", "[0-9A-Z_a-z]"),
            ("[a-cb-f]", "[a-f]"),
            ("[a-bc-d]", "[a-d]"),
            ("[a-]", "[\\-a]"),
            (".", "[^\\u000A\\u000D\\u0085\\u2028-\\u2029]"),
        ];

        for (source, expected) in cases {
            assert_eq!(normalized(source), expected, "pattern {source:?}");
        }
    }

    #[test]
    fn astral_and_invisible_code_points_are_written_as_escapes() {
        assert_eq!(
            normalized("[\u{1F600}-\u{1F602}]"),
            "[\\u{1F600}-\\u{1F602}]"
        );
        assert_eq!(normalized("a\u{2028}"), "a\\u2028");
        assert_eq!(normalized("[\u{85}-\u{a0}]"), "[\\u0085-\\u00A0]");
    }

    #[test]
    fn repetition_bounds_are_checked_and_normalised() {
        assert_eq!(normalized("a{2,2}"), "a{2}");
        assert_eq!(normalized("a{2,}"), "a{2,}");
        assert_eq!(normalized("a{0,1000}"), "a{0,1000}");
        assert_eq!(
            refusal("a{1001}"),
            "the pattern is not portable: a repetition count above 1000 is not portable"
        );
        assert_eq!(
            refusal("a{3,2}"),
            "the pattern is not portable: the repetition {3,2} has its bounds reversed"
        );
        assert!(refusal("a{").contains("starts a repetition"));
        assert!(refusal("a{99999999999999999999999}").contains("above 1000"));
    }

    #[test]
    fn a_malformed_class_or_escape_is_refused_by_name() {
        assert!(refusal("[]").contains("an empty class matches nothing"));
        assert!(refusal("[z-a]").contains("bounds reversed"));
        assert!(refusal(r"[\d-z]").contains("a literal '-' inside a class"));
        assert!(refusal(r"[a-\d]").contains("ends with a shorthand"));
        assert!(refusal(r"\q").contains("'\\q' is not portable"));
        assert!(refusal("[a").contains("ends inside a construct"));
    }

    #[test]
    fn a_repeated_group_that_can_split_a_text_two_ways_is_refused() {
        assert_eq!(
            refusal("(a+)+"),
            "the pattern can backtrack exponentially: '(a+)+' repeats a group whose trailing repetition can match what the group starts with"
        );
        assert!(refusal("(a|ab)*").contains("branches can start with the same character"));
        assert_eq!(normalized("(a+)?"), "(a+)?");
    }
}
