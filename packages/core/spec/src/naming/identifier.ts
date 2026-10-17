// ADR 0007 sections 4 and 5, and the canonical id of ADR 0004 section 9.

import { assertLanguage, isReserved, type Language } from "./reserved.js";
import {
  assertName,
  assertSegments,
  type Name,
  type Role,
  type Suffixes,
  suffixWords,
} from "./roles.js";

export type Style = "pascal" | "camel" | "upperSnake";

/** The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13). */
export type OperationIdCase = "camel" | "snake";

/**
 * The options every target offers for its own language (ADR 0007 section 5, A36), applied after
 * the shared algorithm. The defaults are the ones the shared vectors test.
 */
export interface IdentifierOptions {
  /** The suffix word of each derived role, `[a-z0-9]+` (`input: "dto"` gives `AssignTaskDto`). */
  suffixes?: Suffixes;
  /** The reserved-word escape: `text` as a suffix or a prefix (default a trailing `_`). */
  escape?: { position: "suffix" | "prefix"; text: string };
  /** The casing of enum members, where the language has them (default per language). */
  enumCase?: Style;
}

const STYLES: readonly string[] = ["pascal", "camel", "upperSnake"];
const ESCAPE_TEXT = /^[A-Za-z0-9_]+$/;

/**
 * The style of `role` in `language` (ADR 0007 section 4 table), or `undefined` when the language
 * has no identifier for it: TypeScript enums are string literal unions.
 */
export function styleOf(role: Role, language: Language): Style | undefined {
  assertLanguage(language);
  switch (role) {
    case "operation":
    case "member":
      return "camel";
    case "enumMember":
      if (language === "typescript") return undefined;
      return language === "php" ? "pascal" : "upperSnake";
    case "schema":
    case "input":
    case "output":
    case "query":
    case "headers":
    case "path":
    case "response":
    case "params":
    case "error":
    case "errors":
    case "property":
    case "item":
    case "value":
    case "variant":
    case "endpoints":
      return "pascal";
    default: {
      // ADR 0005 open enums: a role this version does not know is never guessed.
      const unknown: never = role;
      throw new Error(`unknown naming role ${JSON.stringify(unknown)}`);
    }
  }
}

function capitalize(word: string): string {
  const first = word.charCodeAt(0);
  // Segments are `[a-z0-9]+`; a digit has no uppercase form and stays as it is.
  if (first >= 97 && first <= 122) return String.fromCharCode(first - 32) + word.slice(1);
  return word;
}

function join(words: readonly string[], style: Style): string {
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (style === "upperSnake") out += (i > 0 ? "_" : "") + word.toUpperCase();
    else out += style === "camel" && i === 0 ? word : capitalize(word);
  }
  return out;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function escapeOf(options: IdentifierOptions): { position: "suffix" | "prefix"; text: string } {
  const spec = options.escape ?? { position: "suffix", text: "_" };
  if (spec.position !== "suffix" && spec.position !== "prefix") {
    throw new Error(`escape position is suffix or prefix, got ${JSON.stringify(spec.position)}`);
  }
  if (typeof spec.text !== "string" || !ESCAPE_TEXT.test(spec.text)) {
    throw new Error(`escape text is [A-Za-z0-9_]+, got ${JSON.stringify(spec.text)}`);
  }
  if (spec.position === "prefix" && isDigit(spec.text.charCodeAt(0))) {
    throw new Error("a prefix escape cannot start with a digit");
  }
  return spec;
}

/**
 * The identifier of `name` in `language`: the segments and the suffix words joined in the style of
 * the role, a leading `_` when the first word starts with a digit, then the escape (a trailing
 * `_` by default) when the result is a reserved word, or, by role, a shadowed name. `undefined`
 * when the language has no identifier for the role (an enum member in TypeScript). Throws, never
 * guesses, on a malformed name: an unknown role, a segment outside `[a-z0-9]+`, a missing or
 * extra status, an empty result, or a malformed option.
 */
export function identifier(
  name: Name,
  language: Language,
  options: IdentifierOptions = {},
): string | undefined {
  assertLanguage(language);
  assertName(name);
  let style = styleOf(name.role, language);
  if (style === undefined) return undefined;
  if (name.role === "enumMember" && options.enumCase !== undefined) {
    if (!STYLES.includes(options.enumCase)) {
      throw new Error(
        `enumCase is pascal, camel or upperSnake, got ${JSON.stringify(options.enumCase)}`,
      );
    }
    style = options.enumCase;
  }
  const spec = escapeOf(options);
  const words = [...name.segments, ...suffixWords(name, options.suffixes)];
  if (words.length === 0) throw new Error(`a ${name.role} name without segment has no identifier`);
  let out = join(words, style);
  if (isDigit(out.charCodeAt(0))) out = `_${out}`;
  if (isReserved(out, language, name.role)) {
    out = spec.position === "prefix" ? spec.text + out : out + spec.text;
  }
  return out;
}

/**
 * The string of an operation id for `segments` under `conventions.operationIds.case`: pure
 * casing, with no reserved-word escape and no digit escape, because the id is the same string in
 * the IR, in OpenAPI and in `relays`, and it is not a code identifier nor a plain-object key
 * (ADR 0007 section 3). The `order` is applied by the tree pass before.
 */
export function operationId(
  segments: readonly string[],
  idCase: OperationIdCase = "camel",
): string {
  assertSegments(segments);
  if (segments.length === 0) throw new Error("an operation id needs at least one segment");
  if (idCase !== "camel" && idCase !== "snake") {
    throw new Error(`operation id case is camel or snake, got ${JSON.stringify(idCase)}`);
  }
  return idCase === "snake" ? segments.join("_") : join(segments, "camel");
}

/**
 * The canonical id of ADR 0004 section 9 for a derived name: the escaped TypeScript identifier of
 * the name (PascalCase for a schema). An operation follows `operationIdCase` instead.
 * `undefined` for an enum member, which has no TypeScript form.
 */
export function canonicalId(
  name: Name,
  options: { operationIdCase?: OperationIdCase } = {},
): string | undefined {
  assertName(name);
  if (name.role === "operation") return operationId(name.segments, options.operationIdCase);
  return identifier(name, "typescript");
}
