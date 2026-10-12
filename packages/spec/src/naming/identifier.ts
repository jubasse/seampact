// ADR 0007 sections 4 and 5, and the canonical id of ADR 0004 section 9.

import { isReserved, type Language } from "./reserved.js";
import { type Name, type Role, suffixWords } from "./roles.js";

export type Style = "pascal" | "camel" | "upperSnake";

/** The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13). */
export type OperationIdCase = "camel" | "snake";

/**
 * The style of `role` in `language` (ADR 0007 section 4 table), or `undefined` when the language
 * has no identifier for it: TypeScript enums are string literal unions.
 */
export function styleOf(role: Role, language: Language): Style | undefined {
  switch (role) {
    case "operation":
    case "member":
      return "camel";
    case "enumMember":
      if (language === "typescript") return undefined;
      return language === "php" ? "pascal" : "upperSnake";
    default:
      return "pascal";
  }
}

// The roles whose identifier is a type, so that the shadowed type names apply to it.
function isTypeRole(role: Role): boolean {
  return role !== "operation" && role !== "member" && role !== "enumMember";
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

/**
 * The identifier of `name` in `language`: the segments and the suffix words joined in the style of
 * the role, a leading `_` when the first word starts with a digit, then the trailing `_` escape
 * when the result is a reserved word or, for a type, a shadowed name. `undefined` when the
 * language has no identifier for the role (an enum member in TypeScript).
 */
export function identifier(name: Name, language: Language): string | undefined {
  const style = styleOf(name.role, language);
  if (style === undefined) return undefined;
  let out = join([...name.segments, ...suffixWords(name)], style);
  if (out.length > 0 && isDigit(out.charCodeAt(0))) out = `_${out}`;
  if (isReserved(out, language, isTypeRole(name.role))) out += "_";
  return out;
}

/**
 * The string of an operation id for `segments` under `conventions.operationIds.case`: pure
 * casing, with no reserved-word escape, because the id is the same string in the IR, in OpenAPI
 * and in `relays` (ADR 0007 section 3). The `order` is applied by the tree pass before.
 */
export function operationId(
  segments: readonly string[],
  idCase: OperationIdCase = "camel",
): string {
  return idCase === "snake" ? segments.join("_") : join(segments, "camel");
}

/**
 * The canonical id of ADR 0004 section 9 for a derived name: the TypeScript form of the name
 * (PascalCase for a schema). An operation follows `operationIdCase` instead. `undefined` for an
 * enum member, which has no TypeScript form.
 */
export function canonicalId(
  name: Name,
  options: { operationIdCase?: OperationIdCase } = {},
): string | undefined {
  if (name.role === "operation") return operationId(name.segments, options.operationIdCase);
  return identifier(name, "typescript");
}
