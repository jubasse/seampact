import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IR_REVISION, IR_SCHEMA_DOCUMENTS, type SchemaNode } from "@seampact/spec/ir";
import { afterEach, describe, expect, it } from "vitest";
import {
  findOrphanFiles,
  findStaleFiles,
  generateIrModels,
  MAPPING_TABLE_FILE,
  mappingTable,
} from "./generate.ts";
import { KOTLIN_MODEL_DIRECTORY } from "./kotlin.ts";
import { buildNeutralModel, UnhandledSchemaError } from "./model.ts";
import { definitionNames, NameCollisionError } from "./names.ts";
import { PHP_MODEL_DIRECTORY } from "./php.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const BIOME = join(REPO, "node_modules/.bin/biome");
const STRING = { type: "string" };

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

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing`);

  return value;
}

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definitionsOf(document: SchemaNode): Map<string, SchemaNode> {
  const defs = document.$defs;

  if (!isSchemaNode(defs)) throw new Error(`${String(document.$id)} has no $defs`);

  const definitions = new Map<string, SchemaNode>();

  for (const name of Object.keys(defs)) {
    const definition = defs[name];

    if (!isSchemaNode(definition)) throw new Error(`${name} is not a schema`);
    definitions.set(name, definition);
  }

  return definitions;
}

function definitionNamesOfSchema(): string[] {
  return IR_SCHEMA_DOCUMENTS.flatMap((document) => [...definitionsOf(document).keys()]);
}

function committedMappingTable(files: Map<string, string>): unknown {
  return JSON.parse(required(files.get(MAPPING_TABLE_FILE), MAPPING_TABLE_FILE));
}

function kotlinSources(files: Map<string, string>): string {
  return [...files]
    .filter(([path]) => path.startsWith(KOTLIN_MODEL_DIRECTORY))
    .map(([, content]) => content)
    .join("\n");
}

function phpFile(files: Map<string, string>, className: string): string {
  const path = `${PHP_MODEL_DIRECTORY}/${className}.php`;

  return required(files.get(path), path);
}

const SHAPES_FILE = `${KOTLIN_MODEL_DIRECTORY}/IrShapes.kt`;

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

    const kotlinFile = required(
      [...files.keys()].find((path) => path.endsWith("/Operation.kt")),
      "Operation.kt",
    );

    writeFileSync(join(root, kotlinFile), `${files.get(kotlinFile)}// hand edit\n`);
    expect(findStaleFiles(files, root)).toEqual([`${kotlinFile} is stale`]);

    const withHead = IR_SCHEMA_DOCUMENTS.map((document) => {
      const definitions = definitionsOf(document);
      const httpMethod = definitions.get("HttpMethod");

      if (httpMethod === undefined) return document;
      const known = httpMethod["x-seampact-known"];

      if (!Array.isArray(known)) throw new Error("HttpMethod lists no known value");
      const withHeadKnown = { ...httpMethod, "x-seampact-known": [...known, "head"] };

      return {
        ...document,
        $defs: { ...Object.fromEntries(definitions), HttpMethod: withHeadKnown },
      };
    });
    const regenerated = generateIrModels(withHead);

    expect(findStaleFiles(regenerated, temporaryRootWith(files))).toContain(
      `${kotlinFile} is stale`,
    );
  });

  it("a file or directory the generator no longer writes is reported", () => {
    const files = generateIrModels();
    const root = temporaryRootWith(files);

    writeFileSync(join(root, KOTLIN_MODEL_DIRECTORY, "Removed.kt"), "");
    mkdirSync(join(root, KOTLIN_MODEL_DIRECTORY, "nested"));

    expect(findOrphanFiles(files, root)).toEqual([
      { path: `${KOTLIN_MODEL_DIRECTORY}/Removed.kt`, isDirectory: false },
      { path: `${KOTLIN_MODEL_DIRECTORY}/nested`, isDirectory: true },
    ]);
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
    const model = buildNeutralModel();
    const table = mappingTable(model.definitions, definitionNames(model));
    const kotlin = kotlinSources(files);

    expect(Object.keys(table).sort()).toEqual(definitionNamesOfSchema().sort());
    expect(committedMappingTable(files)).toEqual({ irRevision: IR_REVISION, definitions: table });

    for (const definition of model.definitions) {
      const kotlinName = required(table[definition.name], definition.name).kotlin;

      if (definition.kind === "union" || definition.kind === "openEnum") {
        expect(kotlin).toContain(`public sealed interface ${kotlinName} {`);
        expect(kotlin).toMatch(
          new RegExp(`public data class Unknown\\([^)]*\\) : ${kotlinName} \\{\\n`),
        );
      } else if (definition.kind === "struct") {
        expect(kotlin).toContain(`public data class ${kotlinName}(`);
      } else {
        expect(kotlin).toContain(`public typealias ${kotlinName} = `);
      }
    }
  });

  it("every definition is generated in PHP", () => {
    const files = generateIrModels();
    const model = buildNeutralModel();
    const table = mappingTable(model.definitions, definitionNames(model));
    const types = phpFile(files, "IrTypes");

    for (const definition of model.definitions) {
      const phpName = required(table[definition.name], definition.name).php;

      if (definition.kind === "union") {
        expect(phpFile(files, phpName), definition.name).toContain(
          `abstract readonly class ${phpName}\n`,
        );
        expect(phpFile(files, `${phpName}Unknown`), definition.name).toContain(
          `final readonly class ${phpName}Unknown extends ${phpName}\n`,
        );
      } else if (definition.kind === "struct") {
        expect(phpFile(files, phpName), definition.name).toMatch(
          new RegExp(`final readonly class ${phpName}( extends \\w+)?\\n`),
        );
      } else if (definition.kind === "openEnum") {
        expect(phpFile(files, phpName), definition.name).toContain(
          "public static function of(string $value): self",
        );
      } else {
        expect(types, definition.name).toContain(` * @phpstan-type ${phpName} `);
      }
    }
  });

  it("every must-act definition is marked in the PHP shape table", () => {
    const shapes = phpFile(generateIrModels(), "IrShapes");
    const mustAct = buildNeutralModel().definitions.filter((definition) => definition.mustAct);

    for (const definition of mustAct) {
      const entry =
        definition.kind === "union"
          ? "IrShape::union\\('\\w+', true,"
          : "IrShape::openEnum\\(\\[.*\\], true\\),$";

      expect(shapes, definition.name).toMatch(new RegExp(`'${definition.name}' => ${entry}`, "m"));
    }
  });

  it("every must-act definition is marked in the shape table", () => {
    const shapes = required(generateIrModels().get(SHAPES_FILE), SHAPES_FILE);
    const mustAct = buildNeutralModel().definitions.filter((definition) => definition.mustAct);

    expect(mustAct.length).toBeGreaterThan(0);

    for (const definition of mustAct) {
      const entry =
        definition.kind === "union"
          ? 'IrShape\\.Union\\("\\w+", true,'
          : "IrShape\\.OpenEnum\\(.*, true\\)\\)$";

      expect(shapes, definition.name).toMatch(
        new RegExp(`put\\("${definition.name}", ${entry}`, "m"),
      );
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

  it.each([
    [
      "a struct with an additionalProperties schema",
      { Holder: { type: "object", properties: { a: STRING }, additionalProperties: STRING } },
      /^Holder: keyword additionalProperties/,
    ],
    [
      "a struct with a oneOf and no discriminator",
      { Holder: { type: "object", properties: { a: STRING }, oneOf: [STRING] } },
      /^Holder: keyword oneOf/,
    ],
    [
      "properties on an array",
      { Holder: { type: "array", properties: { a: STRING }, items: STRING } },
      /^Holder: a struct of type "array"/,
    ],
    [
      "items on an open enum",
      { Mode: { type: "string", "x-seampact-known": ["on"], items: STRING } },
      /^Mode: keyword items/,
    ],
    [
      "a required name without its member",
      { Holder: { type: "object", required: ["b"], properties: { a: STRING } } },
      /^Holder: required member b has no property/,
    ],
    [
      "a member name that is not an identifier",
      { Holder: { type: "object", properties: { "x-y": STRING } } },
      /^Holder\.x-y: a member name that is not an identifier/,
    ],
    [
      "a map keyed by a struct",
      {
        Key: { type: "object", properties: { a: STRING } },
        Holder: {
          type: "object",
          properties: {
            byKey: {
              type: "object",
              propertyNames: { $ref: "#/$defs/Key" },
              additionalProperties: STRING,
            },
          },
        },
      },
      /^Holder\.byKey\{key\}: a map key Key that is not a string alias or an open enum/,
    ],
    [
      "a $ref below a definition",
      { Holder: { type: "object", properties: { a: { $ref: "#/$defs/Other/properties/b" } } } },
      /^Holder\.a: a \$ref that does not name a definition/,
    ],
    [
      "a union variant with keywords beside its $ref",
      {
        Shape: {
          type: "object",
          discriminator: { propertyName: "kind" },
          oneOf: [{ $ref: "#/$defs/A", properties: {} }],
        },
        A: {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string", const: "a" } },
        },
      },
      /^Shape\.oneOf\[0\]: keyword properties on a reference/,
    ],
    [
      "a discriminator mapping",
      {
        Shape: {
          type: "object",
          discriminator: { propertyName: "kind", mapping: { a: "#/$defs/A" } },
          oneOf: [{ $ref: "#/$defs/A" }],
        },
        A: {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string", const: "a" } },
        },
      },
      /^Shape: discriminator keyword mapping/,
    ],
  ])("unhandled construct fails generation: %s", (_case, definitions, message) => {
    expect(() => buildNeutralModel(syntheticDocuments(definitions))).toThrow(message);
  });

  it("reserved type names are escaped", () => {
    const files = generateIrModels();

    expect(committedMappingTable(files)).toMatchObject({
      definitions: {
        Enum: { construct: "struct", kotlin: "Enum_", php: "Enum_", escapedIn: ["kotlin", "php"] },
      },
    });
    expect(kotlinSources(files)).toContain("public data class Enum_(");
    expect(kotlinSources(files)).toContain("public val enums: Map<EnumId, Enum_>,");
    expect(phpFile(files, "Enum_")).toContain("final readonly class Enum_\n");
  });

  it("escaped name collision fails generation", () => {
    const documents = syntheticDocuments({ Enum: { type: "string" }, Enum_: { type: "string" } });

    expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
    expect(() => generateIrModels(documents)).toThrow(
      /^Enum_: its kotlin name Enum_ collides with the definition Enum/,
    );
  });

  it.each(["JsonObject", "Serializable", "IrIntegerSerializer", "JsonPrimitive", "OptIn"])(
    "a definition named %s, a name the Kotlin files use, fails generation",
    (name) => {
      const documents = syntheticDocuments({ [name]: { type: "string" } });

      expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
      expect(() => generateIrModels(documents)).toThrow(new RegExp(`^${name}: its kotlin name`));
    },
  );

  it.each(["IrHydration", "IrShape", "irmodelexception"])(
    "a definition named %s, a class the PHP files use, fails generation",
    (name) => {
      const documents = syntheticDocuments({ [name]: { type: "object", properties: {} } });

      expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
      expect(() => generateIrModels(documents)).toThrow(
        new RegExp(`^${name}: its (kotlin|php) name`),
      );
    },
  );

  it("a definition named like a union's Unknown subclass fails generation", () => {
    const documents = syntheticDocuments({
      Kind: {
        type: "object",
        discriminator: { propertyName: "kind" },
        oneOf: [{ $ref: "#/$defs/Leaf" }],
      },
      Leaf: {
        type: "object",
        properties: { kind: { type: "string", const: "leaf" } },
        required: ["kind"],
      },
      KindUnknown: { type: "object", properties: {} },
    });

    expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
    expect(() => generateIrModels(documents)).toThrow(/Unknown subclass/);
  });

  it("PHP member names that PHP reserves keep their JSON name", () => {
    const documents = syntheticDocuments({
      Holder: {
        type: "object",
        properties: { this: { type: "string" } },
        required: ["this"],
      },
    });
    const holder = required(
      generateIrModels(documents).get(`${PHP_MODEL_DIRECTORY}/Holder.php`),
      "Holder.php",
    );

    expect(holder).toContain("public string $this_,");
    expect(holder).toContain(
      "this_: IrHydration::string(IrHydration::required($members, 'this', 'Holder'), 'Holder.this')",
    );
    expect(holder).toContain("$json->{'this'} = $this->this_;");
  });

  it("Kotlin keyword members keep their JSON name", () => {
    const kotlin = kotlinSources(generateIrModels());

    expect(kotlin).toContain('@SerialName("in") public val in_: ValueSourceIn,');
    expect(kotlin).toContain('@SerialName("for") public val for_: HeaderUseFor,');
  });
});
