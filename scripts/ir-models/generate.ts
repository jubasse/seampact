import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IR_REVISION, IR_SCHEMA_DOCUMENTS, IR_VERSION, type SchemaNode } from "@seampact/spec/ir";
import { emitKotlin, KOTLIN_CLAIMED_NAMES, KOTLIN_MODEL_DIRECTORY } from "./kotlin.ts";
import { buildNeutralModel, compareNames, type Definition } from "./model.ts";
import { type DefinitionNames, definitionNames } from "./names.ts";
import { emitNamingLists } from "./naming.ts";
import { emitPhp, PHP_CLAIMED_NAMES, PHP_MODEL_DIRECTORY } from "./php.ts";

// Generates every file of the native IR models (ADR 0010) from the IR JSON Schema: the Kotlin and PHP models and the
// mapping table of every definition to its type in each model language.

export const WRITE_COMMAND =
  "node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write";

export const MAPPING_TABLE_FILE = "scripts/ir-models/mapping.generated.json";

/** The directories the generator owns whole: a file there that it does not write is stale. */
const GENERATED_DIRECTORIES = [KOTLIN_MODEL_DIRECTORY, PHP_MODEL_DIRECTORY];

export type MappingEntry = {
  construct: Definition["kind"];
  kotlin: string;
  php: string;
  /** Present when a language's name took the reserved-word escape. */
  escapedIn?: string[];
};

export function generateIrModels(
  documents: readonly SchemaNode[] = IR_SCHEMA_DOCUMENTS,
): Map<string, string> {
  const model = buildNeutralModel(documents);
  const names = definitionNames(model, { kotlin: KOTLIN_CLAIMED_NAMES, php: PHP_CLAIMED_NAMES });

  const files = emitKotlin({
    model,
    names,
    irVersion: IR_VERSION,
    irRevision: IR_REVISION,
    regenerateCommand: WRITE_COMMAND,
  });
  const phpFiles = emitPhp({
    model,
    names,
    irVersion: IR_VERSION,
    irRevision: IR_REVISION,
    regenerateCommand: WRITE_COMMAND,
  });

  for (const [path, content] of phpFiles) files.set(path, content);

  for (const [path, content] of emitNamingLists(WRITE_COMMAND)) files.set(path, content);

  files.set(MAPPING_TABLE_FILE, mappingTableJson(model.definitions, names));

  return files;
}

/** The generated files whose committed copy under `root` differs, each with why. */
export function findStaleFiles(files: Map<string, string>, root: string): string[] {
  const stale: string[] = [];

  for (const [path, content] of files) {
    const target = join(root, path);
    const committed = existsSync(target) ? readFileSync(target, "utf8") : undefined;

    if (committed !== content)
      stale.push(`${path} ${committed === undefined ? "is missing" : "is stale"}`);
  }

  return stale;
}

export interface OrphanEntry {
  path: string;
  /** A directory is never removed by `--write`: it is not a file the generator wrote. */
  isDirectory: boolean;
}

/** The entries of the generated directories under `root` that the generator does not write. */
export function findOrphanFiles(files: Map<string, string>, root: string): OrphanEntry[] {
  const orphans: OrphanEntry[] = [];

  for (const directory of GENERATED_DIRECTORIES) {
    if (!existsSync(join(root, directory))) continue;
    const entries = readdirSync(join(root, directory), { withFileTypes: true });

    for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
      const path = `${directory}/${entry.name}`;

      if (!files.has(path)) orphans.push({ path, isDirectory: entry.isDirectory() });
    }
  }

  return orphans;
}

export function mappingTable(
  definitions: readonly Definition[],
  names: readonly DefinitionNames[],
): Record<string, MappingEntry> {
  const namesByDefinition = new Map(names.map((entry) => [entry.definition, entry]));
  const table: Record<string, MappingEntry> = {};

  for (const definition of definitions) {
    const entry = namesByDefinition.get(definition.name);

    if (entry === undefined) throw new Error(`${definition.name}: no names were computed for it`);
    table[definition.name] = {
      construct: definition.kind,
      kotlin: entry.names.kotlin,
      php: entry.names.php,
      ...(entry.escapedIn.length === 0 ? {} : { escapedIn: entry.escapedIn }),
    };
  }

  return table;
}

function mappingTableJson(
  definitions: readonly Definition[],
  names: readonly DefinitionNames[],
): string {
  const document = { irRevision: IR_REVISION, definitions: mappingTable(definitions, names) };

  return `${biomeStableJson(document, "")}\n`;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [member: string]: JsonValue };

const JSON_INDENT = "  ";

// Biome's JSON layout for the shapes the generator writes: one member per line, and an array of scalars on one
// line (the arrays written here are short). The test runs `biome format` on the output to keep this true.
export function biomeStableJson(value: JsonValue, indent: string): string {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object"))
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    const inner = indent + JSON_INDENT;

    return `[\n${value.map((item) => inner + biomeStableJson(item, inner)).join(",\n")}\n${indent}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);

    if (entries.length === 0) return "{}";
    const inner = indent + JSON_INDENT;
    const lines = entries.map(
      ([member, item]) => `${inner}${JSON.stringify(member)}: ${biomeStableJson(item, inner)}`,
    );

    return `{\n${lines.join(",\n")}\n${indent}}`;
  }

  return JSON.stringify(value);
}
