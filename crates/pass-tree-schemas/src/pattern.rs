//! The portable regular expressions: a written pattern is parsed against the kept subset and stored
//! with its normalised form, in ECMAScript `u` syntax with every engine-dependent construct spelled
//! out: `.` and the shorthands become explicit ASCII classes, and a class becomes its sorted, merged
//! code point ranges. Two shapes that backtrack exponentially are refused too: a repeated group whose
//! tail repetition of variable count can match what the group starts with, and a repeated
//! alternation whose branches can start with the same character.

use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;

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
    fn new(message: String, fix: String) -> Result<Self, PassError> {
        Err(not_ported_yet("PatternRefusal.constructor"))
    }
}

fn refuse<Never>(reason: &str) -> Result<Never, PassError> {
    Err(not_ported_yet("refuse"))
}

fn refuse_backtracking<Never>(reason: &str) -> Result<Never, PassError> {
    Err(not_ported_yet("refuseBacktracking"))
}

fn overlaps(left: &[Range], right: &[Range]) -> Result<bool, PassError> {
    Err(not_ported_yet("overlaps"))
}

fn any_two_overlap(sets: &[Vec<Range>]) -> Result<bool, PassError> {
    Err(not_ported_yet("anyTwoOverlap"))
}

fn runs_at_most_once(repetition: Option<&Repetition>) -> Result<bool, PassError> {
    Err(not_ported_yet("runsAtMostOnce"))
}

fn is_optional(item: &SequenceItem) -> Result<bool, PassError> {
    Err(not_ported_yet("isOptional"))
}

fn varies(repetition: Option<&Repetition>) -> Result<bool, PassError> {
    Err(not_ported_yet("varies"))
}

fn refuse_exponential_repetition(atom: &Atom, repetition: &Repetition) -> Result<(), PassError> {
    Err(not_ported_yet("refuseExponentialRepetition"))
}

fn merged(ranges: &[Range]) -> Result<Vec<Range>, PassError> {
    Err(not_ported_yet("merged"))
}

fn complement(ranges: &[Range]) -> Result<Vec<Range>, PassError> {
    Err(not_ported_yet("complement"))
}

fn hex(code_point: u32) -> Result<String, PassError> {
    Err(not_ported_yet("hex"))
}

fn is_invisible(code_point: u32) -> Result<bool, PassError> {
    Err(not_ported_yet("isInvisible"))
}

fn code_point_text(code_point: u32, syntax: &str) -> Result<String, PassError> {
    Err(not_ported_yet("codePointText"))
}

fn class_text(ranges: &[Range], negated: bool) -> Result<String, PassError> {
    Err(not_ported_yet("classText"))
}

fn literal(code_point: u32, syntax: &str) -> Result<Matched, PassError> {
    Err(not_ported_yet("literal"))
}

fn matching(matched: Matched) -> Result<Atom, PassError> {
    Err(not_ported_yet("matching"))
}

/// A recursive-descent parser over the code points of one pattern.
#[derive(Debug)]
struct PatternParser {
    chars: Vec<char>,
    at: usize,
    group_depth: usize,
}

impl PatternParser {
    fn new(chars: Vec<char>) -> Result<Self, PassError> {
        Err(not_ported_yet("PatternParser.constructor"))
    }

    fn parse(&mut self) -> Result<String, PassError> {
        Err(not_ported_yet("PatternParser.parse"))
    }

    fn peek(&self, offset: usize) -> Result<Option<char>, PassError> {
        Err(not_ported_yet("PatternParser.peek"))
    }

    fn next(&mut self) -> Result<char, PassError> {
        Err(not_ported_yet("PatternParser.next"))
    }

    fn alternation(&mut self) -> Result<Fragment, PassError> {
        Err(not_ported_yet("PatternParser.alternation"))
    }

    fn sequence(&mut self) -> Result<Fragment, PassError> {
        Err(not_ported_yet("PatternParser.sequence"))
    }

    fn atom(&mut self) -> Result<Atom, PassError> {
        Err(not_ported_yet("PatternParser.atom"))
    }

    fn group(&mut self) -> Result<Fragment, PassError> {
        Err(not_ported_yet("PatternParser.group"))
    }

    fn escape(&mut self) -> Result<Matched, PassError> {
        Err(not_ported_yet("PatternParser.escape"))
    }

    fn no_quantifier(&mut self) -> Result<(), PassError> {
        Err(not_ported_yet("PatternParser.noQuantifier"))
    }

    fn quantifier(&mut self) -> Result<Option<Repetition>, PassError> {
        Err(not_ported_yet("PatternParser.quantifier"))
    }

    fn written_quantifier(&mut self) -> Result<Option<Repetition>, PassError> {
        Err(not_ported_yet("PatternParser.writtenQuantifier"))
    }

    fn counted(&mut self) -> Result<Repetition, PassError> {
        Err(not_ported_yet("PatternParser.counted"))
    }

    fn count(&mut self) -> Result<u32, PassError> {
        Err(not_ported_yet("PatternParser.count"))
    }

    fn character_class(&mut self) -> Result<Matched, PassError> {
        Err(not_ported_yet("PatternParser.characterClass"))
    }

    fn class_item(
        &mut self,
        ranges: &mut Vec<Range>,
        first: bool,
    ) -> Result<Option<u32>, PassError> {
        Err(not_ported_yet("PatternParser.classItem"))
    }
}

/// Parses `source` against the portable subset and answers its normalised form, or why it is refused.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] until the function is ported.
pub fn tree_schemas_normalize_pattern(source: &str) -> Result<TreeSchemasPatternResult, PassError> {
    Err(not_ported_yet("treeSchemasNormalizePattern"))
}
