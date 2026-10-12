// ADR 0007 section 5: the reserved and shadowed names, shipped as reserved-words.json.

import data from "../../vectors/naming/reserved-words.json" with { type: "json" };

export type Language = "typescript" | "kotlin" | "java" | "php";

interface Lists {
  caseInsensitive: boolean;
  keywords: ReadonlySet<string>;
  types: ReadonlySet<string>;
}

function lists(raw: { caseInsensitive: boolean; keywords: string[]; types: string[] }): Lists {
  return {
    caseInsensitive: raw.caseInsensitive,
    keywords: new Set(raw.keywords),
    types: new Set(raw.types),
  };
}

const jvm = lists(data.jvm);
const LISTS: Record<Language, Lists> = {
  typescript: lists(data.typescript),
  kotlin: jvm,
  java: jvm,
  php: lists(data.php),
};

/**
 * Whether `identifier` collides with a reserved word of `language`, or, for a type, with a
 * shadowed name. PHP compares case-insensitively (ASCII; its class names are).
 */
export function isReserved(identifier: string, language: Language, isType: boolean): boolean {
  const list = LISTS[language];
  const key = list.caseInsensitive ? identifier.toLowerCase() : identifier;
  return list.keywords.has(key) || (isType && list.types.has(key));
}
