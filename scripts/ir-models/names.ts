import { isReserved, type Language } from "@seampact/spec/naming";
import type { Definition, NeutralModel } from "./model.ts";

// The type name of each definition in each model language. Definition names are the generated-model contract
// (README of the IR schema), so a name is kept as written; a name reserved in a language, judged on the final
// identifier with the lists of ADR 0007, takes the ADR 0007 escape, a trailing `_` (`Enum` becomes `Enum_`).

export const MODEL_LANGUAGES = ["kotlin", "php"] as const satisfies readonly Language[];

export type ModelLanguage = (typeof MODEL_LANGUAGES)[number];

const RESERVED_ESCAPE = "_";

// Every definition is a type, so it is judged with a type role.
const TYPE_ROLE = "schema";

export interface DefinitionNames {
  definition: string;
  names: Record<ModelLanguage, string>;
  /** The languages whose name took the escape. */
  escapedIn: ModelLanguage[];
}

export class NameCollisionError extends Error {}

/**
 * The names of every definition. Fails, naming the definitions, when an escaped name equals another
 * generated name in the same language (case-insensitively in PHP, whose class names are).
 * `reservedNames` lists the language's own helper names the generator writes beside the model.
 */
export function definitionNames(
  model: NeutralModel,
  reservedNames: Record<ModelLanguage, readonly string[]> = { kotlin: [], php: [] },
): DefinitionNames[] {
  const entries = model.definitions.map((definition) => namesOf(definition));

  for (const language of MODEL_LANGUAGES)
    assertDistinct(entries, language, reservedNames[language]);

  return entries;
}

function namesOf(definition: Definition): DefinitionNames {
  const names = { kotlin: definition.name, php: definition.name };
  const escapedIn: ModelLanguage[] = [];

  for (const language of MODEL_LANGUAGES) {
    if (!isReserved(definition.name, language, TYPE_ROLE)) continue;
    names[language] = `${definition.name}${RESERVED_ESCAPE}`;
    escapedIn.push(language);
  }

  return { definition: definition.name, names, escapedIn };
}

function comparable(name: string, language: ModelLanguage): string {
  return language === "php" ? name.toLowerCase() : name;
}

function assertDistinct(
  entries: readonly DefinitionNames[],
  language: ModelLanguage,
  reservedNames: readonly string[],
): void {
  const owners = new Map<string, string>();

  for (const helper of reservedNames)
    owners.set(comparable(helper, language), `the generated helper ${helper}`);

  for (const entry of entries) {
    const key = comparable(entry.names[language], language);
    const owner = owners.get(key);

    if (owner !== undefined) {
      throw new NameCollisionError(
        `${entry.definition}: its ${language} name ${entry.names[language]} collides with ${owner}; rename the definition in the IR schema`,
      );
    }

    owners.set(key, `the definition ${entry.definition}`);
  }
}
