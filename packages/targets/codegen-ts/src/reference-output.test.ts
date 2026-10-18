import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExportRef, importSpecifier, type Link } from "@seampact/codegen-core";
import { afterAll, expect, test } from "vitest";
import {
  OUTPUT_DIRECTORY,
  PROBE_FILE,
  readGoldenIr,
  typeErrorsOf,
} from "./generated-project.test-support.js";
import { target } from "./index.js";

const GOLDEN_IRS = ["tasks", "tasksService"];

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-ts-"));

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

// The api index re-exports every module; a name two modules share would be a type error in the index itself.
const INDEX_PROBE = `import * as Api from "./${OUTPUT_DIRECTORY}/index.js";\nexport type UsesIndex = keyof typeof Api;`;

function probeSource(exportRefs: readonly ExportRef[]): string {
  const link: Link<"types"> = {
    descriptor: { kind: "types", style: "typescript", schemas: {}, operations: {} },
    location: { kind: "relative", path: OUTPUT_DIRECTORY },
  };

  const probes = exportRefs
    .map((exportRef, index) => {
      const specifier = importSpecifier(link, exportRef, PROBE_FILE);

      return `import type { ${exportRef.export} as Probe${index} } from "${specifier}";\nexport type Uses${index} = Probe${index};`;
    })
    .join("\n");

  return `${probes}\n${INDEX_PROBE}`;
}

test.each(GOLDEN_IRS)("the generated reference types compile: %s", async (name) => {
  const ir = readGoldenIr(name);
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["types"]),
  });
  const described = target.describe(ir, {});

  expect(outcome).toMatchObject({ status: "generated" });
  expect(described).toMatchObject({ status: "described" });

  if (outcome.status !== "generated" || described.status !== "described") return;

  const descriptor = described.descriptors.types;

  if (descriptor === undefined) throw new Error("the types target described no types link");

  const exportRefs = [
    ...Object.values(descriptor.schemas).flatMap((exports) => Object.values(exports)),
    ...Object.values(descriptor.operations).flatMap((exports) => Object.values(exports)),
  ];
  const diagnostics = typeErrorsOf(
    join(temporaryRoot, name),
    outcome.files,
    probeSource(exportRefs),
  );

  expect(outcome.files.map((file) => file.path)).toContain("index.ts");
  expect(exportRefs.length).toBeGreaterThan(0);
  expect(diagnostics).toEqual([]);
});
