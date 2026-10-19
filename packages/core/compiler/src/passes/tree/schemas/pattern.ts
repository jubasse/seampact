// The portable regular expressions of ADR 0003 section 9: a written pattern is parsed against the kept subset and
// stored with its normalised form, in ECMAScript `u` syntax with every engine-dependent construct spelled out:
// `.` and the shorthands become explicit ASCII classes, and a class becomes its sorted, merged code point ranges.
// `^` and `$` keep their text and mean the start and the end of the string (each target translates them).

/** The result of normalising a pattern: its normalised form, or why it is refused. */
export type TreeSchemasPatternResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

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

class PatternRefusal extends Error {}

function refuse(reason: string): never {
  throw new PatternRefusal(reason);
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

class PatternParser {
  private at = 0;
  private groupDepth = 0;

  constructor(private readonly chars: readonly string[]) {}

  parse(): string {
    const text = this.alternation();

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

  private alternation(): string {
    const branches = [this.sequence()];

    while (this.peek() === "|") {
      this.at++;
      branches.push(this.sequence());
    }

    return branches.join("|");
  }

  private sequence(): string {
    let text = "";

    while (this.peek() !== undefined && this.peek() !== "|" && this.peek() !== ")") {
      const atom = this.atom();

      text += atom.text + (atom.repeatable ? this.quantifier() : this.noQuantifier());
    }

    return text;
  }

  private atom(): { text: string; repeatable: boolean } {
    const char = this.next();

    switch (char) {
      case "(":
        return { text: this.group(), repeatable: true };
      case "[":
        return { text: this.characterClass(), repeatable: true };
      case ".":
        return { text: classText(LINE_ENDS, true), repeatable: true };
      case "^":
      case "$":
        return { text: char, repeatable: false };
      case "\\":
        return { text: this.escape(), repeatable: true };
      case "*":
      case "+":
      case "?":
        return refuse(`'${char}' has nothing to repeat`);
      case "{":
      case "}":
      case "]":
        return refuse(`a literal '${char}' must be escaped ('\\${char}')`);
      default:
        return { text: codePointText(char.codePointAt(0) ?? 0, METACHARACTERS), repeatable: true };
    }
  }

  private group(): string {
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

    return `${open}${inner})`;
  }

  private escape(): string {
    const char = this.next();
    const shorthand = SHORTHANDS[char.toLowerCase()];

    if (shorthand !== undefined) return classText(shorthand, char !== char.toLowerCase());

    if (METACHARACTERS.has(char)) return `\\${char}`;

    return refuse(`'\\${char}' is not portable; only a metacharacter may be escaped`);
  }

  private noQuantifier(): string {
    const char = this.peek();

    if (char === "*" || char === "+" || char === "?" || char === "{")
      refuse(`'${char}' cannot repeat an anchor`);

    return "";
  }

  private quantifier(): string {
    const char = this.peek();
    let text: string;

    if (char === "*" || char === "+" || char === "?") {
      this.at++;
      text = char;
    } else if (char === "{") {
      this.at++;
      text = this.counted();
    } else {
      return "";
    }

    const after = this.peek();

    if (after === "?" || after === "+")
      refuse("lazy and possessive quantifiers are not portable; use the greedy form");

    return text;
  }

  private counted(): string {
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

    if (max === min) return `{${min}}`;

    return max === undefined ? `{${min},}` : `{${min},${max}}`;
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

  private characterClass(): string {
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

    return classText(ranges, negated);
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
    if (error instanceof PatternRefusal) return { ok: false, reason: error.message };

    throw error;
  }
}
