// ADR 0007 section 5: the reserved and shadowed names, shipped as reserved-words.json.

import data from "../../vectors/naming/reserved-words.json" with { type: "json" };
import { assertRole, isTypeRole, type Role } from "./roles.js";

export const LANGUAGES = ["typescript", "kotlin", "java", "php"] as const;

export type Language = (typeof LANGUAGES)[number];

interface Lists {
  caseInsensitive: boolean;
  keywords: ReadonlySet<string>;
  types: ReadonlySet<string>;
  members: ReadonlySet<string>;
  enumMembers: ReadonlySet<string>;
}

function isLanguage(language: unknown): language is Language {
  return typeof language === "string" && (LANGUAGES as readonly string[]).includes(language);
}

// One entry per language, read through `usedBy`; the schema pins each list's `usedBy` to its key.
const LISTS = new Map<Language, Lists>();

for (const raw of Object.values(data.lists)) {
  const lists: Lists = {
    caseInsensitive: raw.caseInsensitive,
    keywords: new Set(raw.keywords),
    types: new Set(raw.types),
    members: new Set(raw.members),
    enumMembers: new Set(raw.enumMembers),
  };

  for (const language of raw.usedBy) {
    if (!isLanguage(language)) throw new Error(`reserved-words.json: unknown language ${language}`);

    if (LISTS.has(language)) throw new Error(`reserved-words.json: ${language} listed twice`);
    LISTS.set(language, lists);
  }
}

for (const language of LANGUAGES) {
  if (!LISTS.has(language)) throw new Error(`reserved-words.json: no list for ${language}`);
}

/** Throws for a language this version does not know. */
export function assertLanguage(language: unknown): asserts language is Language {
  if (!isLanguage(language)) throw new Error(`unknown naming language ${JSON.stringify(language)}`);
}

/**
 * Whether `identifier`, the final identifier of a name with `role`, collides in `language` with:
 * a keyword (every role); for a type role, a shadowed type name; for a member or an operation,
 * a name that breaks its class or record (generator shapes are not known yet, so escaping is the
 * safe default); for an enum member, a name its enum cannot take. PHP compares
 * case-insensitively (ASCII; its class names are).
 */
export function isReserved(identifier: string, language: Language, role: Role): boolean {
  assertLanguage(language);
  assertRole(role);
  const list = LISTS.get(language) as Lists;
  const key = list.caseInsensitive ? identifier.toLowerCase() : identifier;

  if (list.keywords.has(key)) return true;

  if (isTypeRole(role)) return list.types.has(key);

  if (role === "member" || role === "operation") return list.members.has(key);

  if (role === "enumMember") return list.enumMembers.has(key);

  return false;
}
