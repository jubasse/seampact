import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
  type ReferenceIrChange,
  readGoldenIr,
  referenceChanges,
} from "@seampact/codegen-core/node-server/test-support";
import { isKnownVariant } from "@seampact/spec/ir";
import { beforeAll, describe, expect, test } from "vitest";
import { target as nestjsTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "authored-surface");
const API = "tasks";
const RIGHT_WITH_METADATA = "tasks.read";
const METADATA_KEY = "audit";

const rightWithMetadata: ReferenceIrChange = (ir, api) => {
  const right = ir.rights[RIGHT_WITH_METADATA];

  if (api !== API) return ir;

  if (right === undefined) throw new Error(`the reference holds no ${RIGHT_WITH_METADATA}`);

  return {
    ...ir,
    rights: {
      ...ir.rights,
      [RIGHT_WITH_METADATA]: { ...right, extensions: { acme: { audit: "read" } } },
    },
  };
};

const schemaWithCodeName: ReferenceIrChange = (ir, api) => {
  const task = ir.schemas.Task;

  if (api !== API) return ir;

  if (task === undefined || !isKnownVariant("Schema", task) || task.kind !== "object")
    throw new Error("the reference holds no Task object");

  const [first, ...rest] = task.properties;

  if (first === undefined) throw new Error("the reference Task holds no property");

  const renamed = { ...task, properties: [{ ...first, codeName: "renamed" }, ...rest] };

  return { ...ir, schemas: { ...ir.schemas, Task: renamed } };
};

function generatedFile(project: string, path: string): string {
  return readFileSync(join(project, "generated", path), "utf8");
}

describe("the generated NestJS surface", () => {
  beforeAll(async () => {
    await generateReferenceProject(PROJECT, nestjsTarget, {});
  }, GENERATE_TIMEOUT_MILLISECONDS);

  test("generated types list the properties of every object schema in authored order", () => {
    const ir = readGoldenIr(API);
    const types = generatedFile(PROJECT, `types/${API}/schemas.ts`);
    const objects = Object.values(ir.schemas).flatMap((schema) =>
      isKnownVariant("Schema", schema) && schema.kind === "object" && schema.properties.length > 0
        ? [schema]
        : [],
    );

    expect(objects.length).toBeGreaterThan(0);

    for (const schema of objects) {
      const declaration = types.match(
        new RegExp(`export interface ${schema.id} \\{([\\s\\S]*?)\\n\\}`),
      )?.[1];
      const declared = [...(declaration ?? "").matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);

      expect(declared, schema.id).toEqual(schema.properties.map((property) => property.name));
    }
  });

  test("one composite method decorator per operation, each with its input param decorators", () => {
    const ir = readGoldenIr(API);
    const nestjs = generatedFile(PROJECT, `server/${API}/nestjs.ts`);

    for (const operation of ir.operations) {
      expect(nestjs, operation.id).toMatch(
        new RegExp(
          `export const ${operation.id} =[\\s\\S]*?boundary\\.operation\\("${operation.id}"\\)`,
        ),
      );
    }

    expect(nestjs.match(/boundary\.operation\(/g)).toHaveLength(ir.operations.length);
    expect(nestjs).toContain('boundary.inputPart("getTask", "path")');
    expect(nestjs).toContain('boundary.principal("getTask")');
  });

  test("a codeName on a property is refused by name, as the options codeName, suffixes and perOperation are", async () => {
    await expect(
      generateReferenceProject(PROJECT, nestjsTarget, {}, schemaWithCodeName),
    ).rejects.toThrow("property.codeName");

    for (const option of ["suffixes", "perOperation"]) {
      expect(nestjsTarget.parseOptions({ [option]: true })).toMatchObject({
        status: "refused",
        refusals: [{ code: "options.unknown", message: expect.stringContaining(`'${option}'`) }],
      });
    }
  });

  test("a right's custom metadata reaches the generated route table or is refused by name", async () => {
    const outcome = await generateReferenceProject(
      PROJECT,
      nestjsTarget,
      {},
      referenceChanges(rightWithMetadata),
    ).then(
      () => generatedFile(PROJECT, `server/${API}/routes.ts`),
      (error: unknown) => String(error),
    );

    expect(outcome).toMatch(new RegExp(`${METADATA_KEY}|extensions`));
  });
});
