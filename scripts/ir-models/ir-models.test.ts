import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IR_SCHEMA_DOCUMENTS, type SchemaNode } from "@seampact/spec/ir";
import { afterEach, describe, expect, it } from "vitest";
import {
  findOrphanFiles,
  findStaleFiles,
  generateIrModels,
  MAPPING_TABLE_FILE,
  type MappingEntry,
} from "./generate.ts";
import { KOTLIN_MODEL_DIRECTORY } from "./kotlin.ts";
import { buildNeutralModel, UnhandledSchemaError } from "./model.ts";
import { NameCollisionError } from "./names.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const BIOME = join(REPO, "node_modules/.bin/biome");

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRootWith(files: Map<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ir-models-"));
  temporaryRoots.push(root);
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** A one-file IR schema holding `definitions`, shaped like the real files. */
function syntheticDocuments(definitions: Record<string, SchemaNode>): SchemaNode[] {
  return [
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://seampact.dev/schemas/ir/synthetic.schema.json",
      $defs: definitions,
    },
  ];
}

function definitionNamesOfSchema(): string[] {
  return IR_SCHEMA_DOCUMENTS.flatMap((document) => Object.keys(document.$defs as SchemaNode));
}

function mappingOf(files: Map<string, string>): Record<string, MappingEntry> {
  const table = JSON.parse(files.get(MAPPING_TABLE_FILE) as string) as {
    definitions: Record<string, MappingEntry>;
  };
  return table.definitions;
}

function kotlinSources(files: Map<string, string>): string {
  return [...files]
    .filter(([path]) => path.startsWith(KOTLIN_MODEL_DIRECTORY))
    .map(([, content]) => content)
    .join("\n");
}

describe("ir-models", () => {
  it("models are regenerated", () => {
    const run = spawnSync(
      process.execPath,
      ["--import", "./scripts/ir-models/register.ts", "scripts/ir-models/cli.ts", "--check"],
      { cwd: REPO, encoding: "utf8" },
    );

    expect(run.stderr).toContain("are current");
    expect(run.status).toBe(0);
  });

  it("a hand edit or a schema change without regeneration is stale", () => {
    const files = generateIrModels();
    const root = temporaryRootWith(files);
    expect(findStaleFiles(files, root)).toEqual([]);

    const kotlinFile = [...files.keys()].find((path) => path.endsWith("/Operation.kt")) as string;
    writeFileSync(join(root, kotlinFile), `${files.get(kotlinFile)}// hand edit\n`);
    expect(findStaleFiles(files, root)).toEqual([`${kotlinFile} is stale`]);

    const withHead = IR_SCHEMA_DOCUMENTS.map((document) => {
      const definitions = document.$defs as Record<string, SchemaNode>;
      const httpMethod = definitions.HttpMethod;
      if (httpMethod === undefined) return document;
      const known = [...(httpMethod["x-seampact-known"] as string[]), "head"];
      return {
        ...document,
        $defs: { ...definitions, HttpMethod: { ...httpMethod, "x-seampact-known": known } },
      };
    });
    const regenerated = generateIrModels(withHead);
    expect(findStaleFiles(regenerated, temporaryRootWith(files))).toContain(
      `${kotlinFile} is stale`,
    );
  });

  it("a file the generator no longer writes is reported", () => {
    const files = generateIrModels();
    const root = temporaryRootWith(files);
    writeFileSync(join(root, KOTLIN_MODEL_DIRECTORY, "Removed.kt"), "");

    expect(findOrphanFiles(files, root)).toEqual([`${KOTLIN_MODEL_DIRECTORY}/Removed.kt`]);
  });

  it("every JSON file it writes is Biome-stable", () => {
    const jsonFiles = [...generateIrModels()].filter(([path]) => path.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);

    for (const [path, content] of jsonFiles) {
      const run = spawnSync(BIOME, ["format", `--stdin-file-path=${path}`], {
        cwd: REPO,
        input: content,
        encoding: "utf8",
      });
      expect(run.status, `${path}: ${run.stderr}`).toBe(0);
      expect(run.stdout, path).toBe(content);
    }
  });

  it("every definition is generated", () => {
    const files = generateIrModels();
    const mapping = mappingOf(files);
    const model = buildNeutralModel();
    const kotlin = kotlinSources(files);

    expect(Object.keys(mapping).sort()).toEqual(definitionNamesOfSchema().sort());
    for (const definition of model.definitions) {
      const kotlinName = mapping[definition.name]?.kotlin as string;
      if (definition.kind === "union" || definition.kind === "openEnum") {
        expect(kotlin).toContain(`public sealed interface ${kotlinName} {`);
        expect(kotlin).toMatch(
          new RegExp(`public data class Unknown\\([^)]*\\) : ${kotlinName}\\n`),
        );
      } else if (definition.kind === "struct") {
        expect(kotlin).toContain(`public data class ${kotlinName}(`);
      } else {
        expect(kotlin).toContain(`public typealias ${kotlinName} = `);
      }
    }
  });

  it("unhandled construct fails generation", () => {
    const withNumber = syntheticDocuments({ Price: { type: "number" } });
    const withNot = syntheticDocuments({
      Holder: { type: "object", properties: { value: { not: { type: "string" } } } },
    });
    const withInlineObject = syntheticDocuments({
      Holder: { type: "object", properties: { inner: { type: "object", properties: {} } } },
    });

    expect(() => buildNeutralModel(withNumber)).toThrow(UnhandledSchemaError);
    expect(() => buildNeutralModel(withNumber)).toThrow(/^Price: type "number"/);
    expect(() => buildNeutralModel(withNot)).toThrow(/^Holder\.value: keyword not/);
    expect(() => buildNeutralModel(withInlineObject)).toThrow(/^Holder\.inner: an inline object/);
  });

  it("reserved type names are escaped", () => {
    const files = generateIrModels();
    const mapping = mappingOf(files);

    expect(mapping.Enum).toEqual({
      construct: "struct",
      kotlin: "Enum_",
      php: "Enum_",
      escapedIn: ["kotlin", "php"],
    });
    expect(kotlinSources(files)).toContain("public data class Enum_(");
    expect(kotlinSources(files)).toContain("public val enums: Map<EnumId, Enum_>,");
  });

  it("escaped name collision fails generation", () => {
    const documents = syntheticDocuments({ Enum: { type: "string" }, Enum_: { type: "string" } });

    expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
    expect(() => generateIrModels(documents)).toThrow(
      /^Enum_: its kotlin name Enum_ collides with the definition Enum/,
    );
  });

  it("Kotlin keyword members keep their JSON name", () => {
    const kotlin = kotlinSources(generateIrModels());

    expect(kotlin).toContain('@SerialName("in") public val in_: ValueSourceIn,');
    expect(kotlin).toContain('@SerialName("for") public val for_: HeaderUseFor,');
  });
});
