// Assembles the authoring JSON Schemas of `@seampact/spec/schemas/authoring/<file>.schema.json`
// (ADR 0002 section 3): one per file kind and per fragment kind, plus `common`, the definitions
// they share. File kinds reference fragment kinds by relative `$ref`, so one definition serves both.

import {
  AUTHORING_FILES,
  type AuthoringFile,
  type JsonSchema,
  localiseRefs,
  map,
  ref,
} from "./dsl.js";
import { catalogues } from "./grammar/catalogues.js";
import { commonDefs, KEYS } from "./grammar/common.js";
import { conventionsDefs } from "./grammar/conventions.js";
import {
  apiDefs,
  apiFile,
  baseDefs,
  baseFile,
  packDefs,
  packFile,
  workspaceDefs,
  workspaceFile,
} from "./grammar/files.js";
import { nodeDefs, nodeErrorsDefs } from "./grammar/node.js";
import { schemaDefs } from "./grammar/schema.js";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export { AUTHORING_FILES, type AuthoringFile, type JsonSchema } from "./dsl.js";

interface Part {
  title: string;
  root: JsonSchema;
  defs: Record<string, JsonSchema>;
}

function parts(): Record<AuthoringFile, Part> {
  const catalogueParts = Object.fromEntries(
    catalogues().map((c) => [
      c.file,
      {
        title: `seampact ${c.file} catalogue`,
        root: {
          description: `${c.description} A name-keyed catalogue file.`,
          ...map({ keys: c.keys, keyDescription: c.keyDescription, values: c.entry }),
        },
        defs: c.defs,
      },
    ]),
  ) as Record<string, Part>;
  const all: Record<string, Part> = {
    workspace: { title: "seampact workspace file", root: workspaceFile(), defs: workspaceDefs() },
    api: { title: "seampact api file", root: apiFile(), defs: apiDefs() },
    base: { title: "seampact base file", root: baseFile(), defs: baseDefs() },
    pack: { title: "seampact pack file", root: packFile(), defs: packDefs() },
    node: {
      title: "seampact tree node",
      root: {
        description: "A tree node fragment: a route, a relay route, a collection or a single.",
        ...ref("node", "surfaceChild"),
      },
      defs: nodeDefs(),
    },
    "node-errors": {
      title: "seampact node errors map",
      root: {
        description:
          "A node's errors map: each code attached, narrowed or declared (ADR 0002 section 11).",
        ...map({
          keys: KEYS.errorCode,
          keyDescription: "an error code",
          values: ref("node-errors", "attachment"),
        }),
      },
      defs: nodeErrorsDefs(),
    },
    conventions: {
      title: "seampact conventions",
      root: ref("conventions", "conventions"),
      defs: conventionsDefs(),
    },
    schema: { title: "seampact schema", root: ref("schema", "schema"), defs: schemaDefs() },
    common: {
      title: "seampact shared definitions",
      root: { description: "Definitions the other authoring schemas reference." },
      defs: commonDefs(),
    },
    ...catalogueParts,
  };

  return all as Record<AuthoringFile, Part>;
}

let cache: Readonly<Record<AuthoringFile, JsonSchema>> | undefined;

// The authoring schemas, keyed by file (without `.schema.json`), as published.
export function authoringSchemas(): Readonly<Record<AuthoringFile, JsonSchema>> {
  if (cache === undefined) {
    const p = parts();
    const out = {} as Record<AuthoringFile, JsonSchema>;

    for (const file of AUTHORING_FILES) {
      const part = p[file];
      const schema: JsonSchema = {
        $schema: JSON_SCHEMA_DIALECT,
        title: part.title,
        ...part.root,
        $defs: part.defs,
      };

      out[file] = localiseRefs(schema, file) as JsonSchema;
    }

    cache = out;
  }

  return cache;
}

export function authoringSchemaFileName(file: AuthoringFile): string {
  return `${file}.schema.json`;
}
