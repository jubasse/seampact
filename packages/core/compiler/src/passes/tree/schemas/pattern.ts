// The portable regular expressions of ADR 0003 section 9: a written pattern is parsed against the kept subset and
// stored with its normalised form, in ECMAScript `u` syntax with every engine-dependent construct spelled out:
// `.` and the shorthands become explicit ASCII classes, and a class becomes its sorted, merged code point ranges.
// `^` and `$` keep their text and mean the start and the end of the string (each target translates them).
// A pattern that can backtrack exponentially is refused too, since the targets run it on request text: a repeated
// group ending in a repetition of variable count over characters the group can start with (`(a+)+`), or a repeated
// alternation whose branches can start with the same character (`(a|ab)*`).

/** The result of normalising a pattern: its normalised form, or why it is refused and how to fix it. */
export type TreeSchemasPatternResult =
  | { ok: true; normalized: string }
  | { ok: false; message: string; fix: string };

type Range = readonly [number, number];

const MAX_CODE_POINT = 0x10ffff;

// RE2 refuses a repetition count above 1000, so a portable pattern stays within it.
const MAX_REPEAT = 1000;

// The parser recurses once per group: deeper nesting is refused before it exhausts the stack. No real pattern
// comes near it.
const MAX_GROUP_DEPTH = 100;

const METACHARACTERS = new Set([..."\\^$.|?*+()[]{}/"]);

/** Escapes every character ADR 0003 section 9 lets a pattern escape, so `text` matches itself literally. */
export function treeSchemasEscapePatternLiteral(text: string): string {
  return [...text].map((char) => (METACHARACTERS.has(char) ? `\\${char}` : char)).join("");
}

const DIGITS: readonly Range[] = [[0x30, 0x39]];
const WORD: readonly Range[] = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
];
// \t \n \v \f \r and the space: ASCII only, as ADR 0003 section 9 fixes it.
const SPACE: readonly Range[] = [
  [0x09, 0x0d],
  [0x20, 0x20],
];
// What `.` never matches: \n, \r, U+0085, U+2028 and U+2029.
const LINE_ENDS: readonly Range[] = [
  [0x0a, 0x0a],
  [0x0d, 0x0d],
  [0x85, 0x85],
  [0x2028, 0x2029],
];
const SHORTHANDS: Readonly<Record<string, readonly Range[]>> = { d: DIGITS, w: WORD, s: SPACE };

const PORTABLE_FIX = "rewrite it in the portable subset of ADR 0003 section 9";

const BACKTRACKING_FIX =
  "rewrite it so no repeated group holds a repetition of variable count or branches that start with the same character, or check that text in the application's code (A45)";

class PatternRefusal extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}

function refuse(reason: string): never {
  throw new PatternRefusal(`the pattern is not portable: ${reason}`, PORTABLE_FIX);
}

function refuseBacktracking(reason: string): never {
  throw new PatternRefusal(`the pattern can backtrack exponentially: ${reason}`, BACKTRACKING_FIX);
}

// What the backtracking checks know of a parsed fragment besides its normalised text: the code points it can
// start and end with, the code points a trailing repetition of variable count (followed only by optional parts)
// can end it with, whether it can match the empty string, and whether two branches of its alternation, seen
// through groups of a single branch, can start with the same code point.
interface Fragment {
  readonly text: string;
  readonly first: readonly Range[];
  readonly last: readonly Range[];
  readonly varyingTail: readonly Range[];
  readonly nullable: boolean;
  readonly overlapping: boolean;
}

interface Atom extends Fragment {
  readonly repeatable: boolean;
}

/** A quantifier as written: its normalised text and its bounds, `max` undefined when unbounded. */
interface Repetition {
  readonly text: string;
  readonly min: number;
  readonly max: number | undefined;
}

const ONCE = 1;

const overlaps = (left: readonly Range[], right: readonly Range[]): boolean =>
  left.some(([leftStart, leftEnd]) =>
    right.some(([rightStart, rightEnd]) => leftStart <= rightEnd && rightStart <= leftEnd),
  );

const anyTwoOverlap = (sets: readonly (readonly Range[])[]): boolean =>
  sets.some((set, index) => sets.slice(index + 1).some((other) => overlaps(set, other)));

const varies = (repetition: Repetition | undefined): boolean =>
  repetition !== undefined && repetition.min !== repetition.max;

// A repetition that can run more than once must not wrap a fragment that can split one text several ways: one
// whose trailing repetition can go on into the next pass, or whose branches can start alike.
function refuseExponentialRepetition(atom: Atom, repetition: Repetition): void {
  if (repetition.max !== undefined && repetition.max <= ONCE) return;

  if (overlaps(atom.varyingTail, atom.first))
    refuseBacktracking(
      `'${atom.text}${repetition.text}' repeats a group whose trailing repetition can match what the group starts with`,
    );

  if (atom.overlapping)
    refuseBacktracking(
      `'${atom.text}${repetition.text}' repeats an alternation whose branches can start with the same character`,
    );
}

function merged(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];

  for (const [start, end] of sorted) {
    const last = out.at(-1);

    if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }

  return out;
}

function complement(ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  let next = 0;

  for (const [start, end] of merged(ranges)) {
    if (start > next) out.push([next, start - 1]);
    next = end + 1;
  }

  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);

  return out;
}

const hex = (codePoint: number): string => codePoint.toString(16).toUpperCase().padStart(4, "0");

const isInvisible = (codePoint: number): boolean =>
  codePoint < 0x20 ||
  (codePoint >= 0x7f && codePoint <= 0xa0) ||
  codePoint === 0x2028 ||
  codePoint === 0x2029;

// A code point as text: astral and invisible ones as `\u` escapes, the characters `syntax` names escaped.
function codePointText(codePoint: number, syntax: ReadonlySet<string>): string {
  if (codePoint > 0xffff) return `\\u{${hex(codePoint)}}`;

  if (isInvisible(codePoint)) return `\\u${hex(codePoint)}`;
  const char = String.fromCodePoint(codePoint);

  return syntax.has(char) ? `\\${char}` : char;
}

const CLASS_SYNTAX = new Set([..."\\]-[^"]);

function classText(ranges: readonly Range[], negated: boolean): string {
  const text = (codePoint: number) => codePointText(codePoint, CLASS_SYNTAX);
  const body = merged(ranges)
    .map(([start, end]) => (start === end ? text(start) : `${text(start)}-${text(end)}`))
    .join("");

  return `[${negated ? "^" : ""}${body}]`;
}

/** A single-character atom: its normalised text and the code points it matches. */
interface Matched {
  readonly text: string;
  readonly ranges: readonly Range[];
}

const literal = (codePoint: number, syntax: ReadonlySet<string>): Matched => ({
  text: codePointText(codePoint, syntax),
  ranges: [[codePoint, codePoint]],
});

const matching = ({ text, ranges }: Matched): Atom => ({
  text,
  first: ranges,
  last: ranges,
  varyingTail: [],
  nullable: false,
  repeatable: true,
  overlapping: false,
});

const SYMBOL_BOUNDS: Readonly<Record<string, Omit<Repetition, "text">>> = {
  "*": { min: 0, max: undefined },
  "+": { min: 1, max: undefined },
  "?": { min: 0, max: 1 },
};

class PatternParser {
  private at = 0;
  private groupDepth = 0;

  constructor(private readonly chars: readonly string[]) {}

  parse(): string {
    const { text } = this.alternation();

    if (this.at < this.chars.length) refuse(`'${this.peek()}' is not expected here; escape it`);

    return text;
  }

  private peek(offset = 0): string | undefined {
    return this.chars[this.at + offset];
  }

  private next(): string {
    const char = this.chars[this.at++];

    if (char === undefined) refuse("the pattern ends inside a construct");

    return char;
  }

  private alternation(): Fragment {
    const branches = [this.sequence()];

    while (this.peek() === "|") {
      this.at++;
      branches.push(this.sequence());
    }

    return {
      text: branches.map((branch) => branch.text).join("|"),
      first: branches.flatMap((branch) => branch.first),
      last: branches.flatMap((branch) => branch.last),
      varyingTail: branches.flatMap((branch) => branch.varyingTail),
      nullable: branches.some((branch) => branch.nullable),
      overlapping:
        anyTwoOverlap(branches.map((branch) => branch.first)) ||
        (branches.length === 1 && branches.some((branch) => branch.overlapping)),
    };
  }

  private sequence(): Fragment {
    let text = "";
    let first: Range[] = [];
    let last: Range[] = [];
    let varyingTail: Range[] = [];
    let nullable = true;
    const items: { atom: Atom; repetition: Repetition | undefined }[] = [];

    while (this.peek() !== undefined && this.peek() !== "|" && this.peek() !== ")") {
      const atom = this.atom();
      const repetition = atom.repeatable ? this.quantifier() : this.noQuantifier();

      if (repetition !== undefined) refuseExponentialRepetition(atom, repetition);
      text += atom.text + (repetition?.text ?? "");
      items.push({ atom, repetition });

      // An optional item keeps what the items before it can end with; a required one replaces it.
      const optional = atom.nullable || repetition?.min === 0;
      const itemTail = varies(repetition) ? [...atom.last, ...atom.varyingTail] : atom.varyingTail;

      if (nullable) first = [...first, ...atom.first];
      last = optional ? [...last, ...atom.last] : [...atom.last];
      varyingTail = optional ? [...varyingTail, ...itemTail] : [...itemTail];
      nullable = nullable && optional;
    }

    // A group of a single unrepeated item shows that item's overlap: `((a|ab))*` repeats `(a|ab)`.
    const [only] = items;
    const overlapping =
      items.length === 1 &&
      only !== undefined &&
      only.repetition === undefined &&
      only.atom.overlapping;

    return { text, first, last, varyingTail, nullable, overlapping };
  }

  private atom(): Atom {
    const char = this.next();

    switch (char) {
      case "(":
        return { ...this.group(), repeatable: true };
      case "[":
        return matching(this.characterClass());
      case ".":
        return matching({ text: classText(LINE_ENDS, true), ranges: complement(LINE_ENDS) });
      case "^":
      case "$":
        return {
          text: char,
          first: [],
          last: [],
          varyingTail: [],
          nullable: true,
          repeatable: false,
          overlapping: false,
        };
      case "\\":
        return matching(this.escape());
      case "*":
      case "+":
      case "?":
        return refuse(`'${char}' has nothing to repeat`);
      case "{":
      case "}":
      case "]":
        return refuse(`a literal '${char}' must be escaped ('\\${char}')`);
      default:
        return matching(literal(char.codePointAt(0) ?? 0, METACHARACTERS));
    }
  }

  private group(): Fragment {
    let open = "(";

    if (this.peek() === "?") {
      if (this.peek(1) !== ":")
        refuse("lookarounds, named groups and inline flags are not portable; use '(?:' or '('");
      this.at += 2;
      open = "(?:";
    }

    this.groupDepth++;

    if (this.groupDepth > MAX_GROUP_DEPTH)
      refuse(`groups nested more than ${MAX_GROUP_DEPTH} deep are not portable`);
    const inner = this.alternation();

    if (this.next() !== ")") refuse("a group is not closed");
    this.groupDepth--;

    return { ...inner, text: `${open}${inner.text})` };
  }

  private escape(): Matched {
    const char = this.next();
    const shorthand = SHORTHANDS[char.toLowerCase()];

    if (shorthand !== undefined) {
      const negated = char !== char.toLowerCase();

      return {
        text: classText(shorthand, negated),
        ranges: negated ? complement(shorthand) : shorthand,
      };
    }

    if (METACHARACTERS.has(char)) return literal(char.codePointAt(0) ?? 0, METACHARACTERS);

    return refuse(`'\\${char}' is not portable; only a metacharacter may be escaped`);
  }

  private noQuantifier(): undefined {
    const char = this.peek();

    if (char === "*" || char === "+" || char === "?" || char === "{")
      refuse(`'${char}' cannot repeat an anchor`);

    return undefined;
  }

  private quantifier(): Repetition | undefined {
    const repetition = this.writtenQuantifier();
    const after = this.peek();

    if (repetition !== undefined && (after === "?" || after === "+"))
      refuse("lazy and possessive quantifiers are not portable; use the greedy form");

    return repetition;
  }

  private writtenQuantifier(): Repetition | undefined {
    const char = this.peek();

    if (char === "{") {
      this.at++;

      return this.counted();
    }

    const bounds = char === undefined ? undefined : SYMBOL_BOUNDS[char];

    if (char === undefined || bounds === undefined) return undefined;
    this.at++;

    return { text: char, ...bounds };
  }

  private counted(): Repetition {
    const min = this.count();
    let max: number | undefined = min;

    if (this.peek() === ",") {
      this.at++;
      max = this.peek() === "}" ? undefined : this.count();
    }

    if (this.next() !== "}")
      refuse("a '{' starts a repetition '{n}', '{n,}' or '{n,m}'; escape a literal '{'");

    if (max !== undefined && max < min)
      refuse(`the repetition {${min},${max}} has its bounds reversed`);

    if (max === min) return { text: `{${min}}`, min, max };

    return { text: max === undefined ? `{${min},}` : `{${min},${max}}`, min, max };
  }

  private count(): number {
    let digits = "";

    for (let char = this.peek(); char !== undefined && /[0-9]/.test(char); char = this.peek()) {
      digits += char;
      this.at++;
    }

    if (digits === "")
      refuse("a '{' starts a repetition '{n}', '{n,}' or '{n,m}'; escape a literal '{'");
    const count = Number(digits);

    if (count > MAX_REPEAT) refuse(`a repetition count above ${MAX_REPEAT} is not portable`);

    return count;
  }

  private characterClass(): Matched {
    const negated = this.peek() === "^";

    if (negated) this.at++;
    const ranges: Range[] = [];
    const first = this.at;

    while (this.peek() !== "]") {
      const start = this.classItem(ranges, this.at === first);

      if (start === undefined) continue;

      if (this.peek() === "-" && this.peek(1) !== "]") {
        this.at++;
        const end = this.classItem(ranges, false);

        if (end === undefined) refuse("a range in a class ends with a shorthand");

        if (end < start) refuse("a range in a class has its bounds reversed");
        ranges.push([start, end]);
      } else {
        ranges.push([start, start]);
      }
    }

    this.at++;

    if (this.at - 1 === first) refuse("an empty class matches nothing");

    return { text: classText(ranges, negated), ranges: negated ? complement(ranges) : ranges };
  }

  // One class member: a code point, or undefined for a shorthand whose ranges it added to `ranges`.
  private classItem(ranges: Range[], first: boolean): number | undefined {
    const char = this.next();

    if (char === "-" && !first && this.peek() !== "]")
      refuse("a literal '-' inside a class must be escaped unless it is first or last");

    if (char === "{" || char === "}") refuse(`a literal '${char}' must be escaped ('\\${char}')`);

    if (char !== "\\") return char.codePointAt(0) ?? 0;
    const escaped = this.next();
    const shorthand = SHORTHANDS[escaped.toLowerCase()];

    if (shorthand !== undefined) {
      ranges.push(...(escaped === escaped.toLowerCase() ? shorthand : complement(shorthand)));

      return undefined;
    }

    if (METACHARACTERS.has(escaped) || escaped === "-") return escaped.codePointAt(0) ?? 0;

    return refuse(`'\\${escaped}' is not portable; only a metacharacter or '-' may be escaped`);
  }
}

/** Parses a written pattern against the portable subset and returns its normalised form (ADR 0003 section 9). */
export function treeSchemasNormalizePattern(source: string): TreeSchemasPatternResult {
  try {
    return { ok: true, normalized: new PatternParser(Array.from(source)).parse() };
  } catch (error) {
    if (error instanceof PatternRefusal)
      return { ok: false, message: error.message, fix: error.fix };

    throw error;
  }
}
