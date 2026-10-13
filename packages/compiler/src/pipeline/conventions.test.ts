import { expect, test } from "vitest";
import { derivationRoles } from "../derivations/roles.js";
import { loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import type { JsonObject, JsonValue, RawApi } from "../raw-tree.js";
import { validateDocument } from "../validate/index.js";
import { pipelineConventionDefaults, pipelineConventions } from "./conventions.js";
import {
  pipelineParseDuration,
  pipelineParseSize,
  pipelineUnitPattern,
  pipelineUnits,
} from "./units.js";

function rawApi(api: string, shared: string): RawApi {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({
      "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n  shared: ./shared.yaml\n",
      "a.yaml": `api: { name: a, version: 1 }\n${api}`,
      "shared.yaml": shared,
    }),
    entry: "workspace.yaml",
  });
  expect(loaded.diagnostics).toEqual([]);
  const raw = loaded.workspace.apis[0];
  if (raw === undefined) throw new Error("no api");
  return raw;
}

test("conventions read written values with their origins, else the core defaults", () => {
  const conventions = pipelineConventions(
    rawApi(
      "conventions:\n  paging: { maxLimit: 50 }\n  errors: { derived: { forbidden: a.denied } }\n",
      "conventions:\n  bodyLimit: 2MiB\n  paging: { maxLimit: 100, default: cursor }\n",
    ),
  );
  // The api's leaf wins over the shared file's, and keeps the shared file's other leaves.
  expect(conventions.get("paging.maxLimit")).toEqual({
    value: 50,
    origin: { layer: "api", pointer: "/conventions/paging/maxLimit" },
  });
  expect(conventions.get("paging.default")?.origin?.layer).toBe("shared");
  // A core default has no origin; a default that is another key's value carries that key's origin.
  expect(conventions.get("format")).toEqual({ value: "bare" });
  expect(conventions.get("paging.defaultLimit")).toEqual(conventions.get("paging.maxLimit"));
  expect(conventions.get("batch.bodyLimit")).toEqual({
    value: "2MiB",
    origin: { layer: "shared", pointer: "/conventions/bodyLimit" },
  });
  // Role bindings: a written one, else the role's default code.
  expect(conventions.get("errors.derived.forbidden")?.value).toBe("a.denied");
  expect(conventions.get("errors.derived.notFound")).toEqual({
    value: derivationRoles.find((r) => r.role === "notFound")?.defaultCode,
  });
  // `idempotency` unset: no default below it; no default at all for a key without one.
  expect(conventions.get("idempotency.methods")).toBeUndefined();
  expect(conventions.get("rateLimit.header")).toBeUndefined();
  expect(conventions.get("nothing.here")).toBeUndefined();
  expect(Object.isFrozen(conventions.get("format"))).toBe(true);

  const idempotent = pipelineConventions(
    rawApi("conventions:\n  idempotency: { header: Idempotency-Key }\n", "{}\n"),
  );
  expect(idempotent.get("idempotency.methods")).toEqual({
    value: ["post", "put", "patch", "delete"],
  });
});

test("every convention default is a valid convention value", () => {
  const tree: JsonObject = {};
  for (const entry of pipelineConventionDefaults) {
    if (!("value" in entry)) continue;
    const segments = entry.path.split(".");
    let at = tree;
    for (const segment of segments.slice(0, -1)) {
      const next = at[segment];
      if (typeof next === "object" && next !== null && !Array.isArray(next)) {
        at = next;
      } else {
        const fresh: JsonObject = {};
        at[segment] = fresh;
        at = fresh;
      }
    }
    at[segments[segments.length - 1] as string] = structuredClone(entry.value) as JsonValue;
  }
  expect(validateDocument("conventions", tree, "api")).toEqual([]);
  expect(Object.isFrozen(pipelineConventionDefaults[0])).toBe(true);
});

test("unit readers follow the grammar", () => {
  expect(pipelineParseSize("1MiB")).toBe(1_048_576);
  expect(pipelineParseSize("512KiB")).toBe(524_288);
  expect(pipelineParseSize("10B")).toBe(10);
  expect(pipelineParseDuration("150ms")).toBe(150);
  expect(pipelineParseDuration("24h")).toBe(86_400_000);
  expect(pipelineParseDuration("2d")).toBe(172_800_000);
  for (const text of ["1 MiB", "1GiB", "-1s", "1.5s", "s", ""]) {
    expect(pipelineParseSize(text)).toBeUndefined();
    expect(pipelineParseDuration(text)).toBeUndefined();
  }
  expect(pipelineParseSize(`${"9".repeat(20)}MiB`)).toBeUndefined();
  // Each reader knows every unit its grammar pattern accepts, and no other.
  for (const kind of ["size", "duration"] as const) {
    const units = /\(\?:([^)]*)\)/.exec(pipelineUnitPattern(kind))?.[1]?.split("|");
    expect(units?.sort()).toEqual(Object.keys(pipelineUnits[kind]).sort());
  }
});
