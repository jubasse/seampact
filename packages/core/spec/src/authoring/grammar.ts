// The grammar's keyword set (SM-6): every keyword the authoring schemas accept, per mapping, with
// the ADR section that defines it. `grammar.test.ts` compares it with the committed snapshot.

import { EXTENSION_KEY, type JsonSchema } from "./dsl.js";
import { AUTHORING_FILES, authoringSchemaFileName, authoringSchemas } from "./schemas.js";

export interface GrammarKeywords {
  // `<file>#<pointer of the mapping>` to keyword to ADR section.
  mappings: Record<string, Record<string, string>>;
  // Keywords whose `$comment` names no ADR section.
  unreferenced: string[];
}

const ADR_REFERENCE = /^ADR \d{4}( section \d+)?$/;

export function grammarKeywords(): GrammarKeywords {
  const mappings: Record<string, Record<string, string>> = {};
  const unreferenced: string[] = [];
  const schemas = authoringSchemas();
  const visit = (node: unknown, where: string): void => {
    if (Array.isArray(node)) {
      for (const [i, child] of node.entries()) visit(child, `${where}/${i}`);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const schema = node as JsonSchema;
    if (schema.additionalProperties === false && typeof schema.properties === "object") {
      const keywords: Record<string, string> = {};
      for (const [key, value] of Object.entries(schema.properties as JsonSchema)) {
        const property = value as JsonSchema;
        if (key === "$include" || property.title === "refused") continue;
        const section = property.$comment;
        if (typeof section === "string" && ADR_REFERENCE.test(section)) keywords[key] = section;
        else unreferenced.push(`${where}: ${key}`);
      }
      const patterns = schema.patternProperties as JsonSchema | undefined;
      if (patterns !== undefined && EXTENSION_KEY in patterns) {
        keywords["x-<prefix>-<key>"] = String((patterns[EXTENSION_KEY] as JsonSchema).$comment);
      }
      mappings[where] = keywords;
    }
    for (const [key, child] of Object.entries(schema)) {
      visit(child, `${where}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    }
  };
  for (const file of AUTHORING_FILES) visit(schemas[file], `${authoringSchemaFileName(file)}#`);
  return { mappings, unreferenced };
}
