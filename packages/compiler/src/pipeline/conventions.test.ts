import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { derivationRoles } from "../derivations/roles.js";
import { loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import type { JsonObject, JsonValue, RawApi } from "../raw-tree.js";
import { validateDocument } from "../validate/index.js";
import {
  type ConventionPath,
  pipelineConventionDefaults,
  pipelineConventionLeaves,
  pipelineConventionSchemaLeaves,
  pipelineConventions,
} from "./conventions.js";
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
  expect(conventions.get("cache.families.minute")).toBeUndefined();
  expect(Object.isFrozen(conventions.get("format"))).toBe(true);

  const idempotent = pipelineConventions(
    rawApi("conventions:\n  idempotency: { header: Idempotency-Key }\n", "{}\n"),
  );
  expect(idempotent.get("idempotency.methods")).toEqual({
    value: ["post", "put", "patch", "delete"],
  });
});

test("conventions read only a leaf of the conventions schema, or an entry of a map leaf", () => {
  const conventions = pipelineConventions(rawApi("", "{}\n"));
  const refused = (path: string) => () => conventions.get(path as ConventionPath);
  // A typo, an object, an entry below a value leaf, a key a map leaf refuses, `$include`, nothing at all.
  for (const path of [
    "bodylimit",
    "nothing.here",
    "idempotency",
    "ops.list",
    "format.name",
    "errors.derived.nope",
    "cache.families.Minute",
    "cache.families.$include",
    "",
  ])
    expect(refused(path), path).toThrow(/is no leaf of the conventions schema/);
  // @ts-expect-error a path outside `ConventionPath` fails to compile as well.
  expect(() => conventions.get("idempotency")).toThrow(/conventions\.idempotency is no leaf/);
  expect(conventions.get("cache.families")).toEqual({ value: {} });
  expect(conventions.get("errors.derived")).toBeUndefined();
  expect(conventions.get("ops.batch.path")).toEqual({ value: "batch" });
});

test("the convention paths equal the conventions schema's leaves", () => {
  const leaves = pipelineConventionSchemaLeaves();
  expect([...pipelineConventionLeaves].sort()).toEqual([...leaves.keys()].sort());
  const maps = [...leaves].flatMap(([path, entries]) => (entries === undefined ? [] : [path]));
  expect(maps.sort()).toEqual(["cache.families", "errors.derived"]);
  for (const role of derivationRoles)
    expect(leaves.get("errors.derived")?.test(role.role), role.role).toBe(true);
});

// ADR 0002 section 13: the conventions table, a row per key with its meaning and its default.
const ADR_0002 = readFileSync(
  fileURLToPath(
    new URL("../../../../docs/grammar/13-conventions-and-wire-formats.md", import.meta.url),
  ),
  "utf8",
);

// ADR 0002 section 6: the ops shorthand table.
const ADR_0002_SECTION_6 = readFileSync(
  fileURLToPath(new URL("../../../../docs/grammar/06-surfaces-and-the-tree.md", import.meta.url)),
  "utf8",
);

// The rows of the first table under `heading` whose header starts with `header`, as unescaped cells.
function adrTable(source: string, heading: string, header: string): string[][] {
  const section = source.slice(source.indexOf(heading));
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line.startsWith(header));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replaceAll("\\|", "|")),
    );
  }
  return rows;
}

test("every convention default traces to the ADR 0002 section 13 table", () => {
  const table = adrTable(ADR_0002, "### 13. Conventions and wire formats", "| Key | Meaning |").map(
    ([key = "", meaning = "", fallback = ""]) => ({
      key: key.replaceAll("`", ""),
      meaning,
      fallback,
    }),
  );
  const ops = adrTable(ADR_0002_SECTION_6, "#### The `ops` shorthand", "| Op | On |");
  expect(table.length).toBeGreaterThan(20);
  const rowOf = (path: string) =>
    table
      .filter((row) => path === row.key || path.startsWith(`${row.key}.`))
      .sort((a, b) => b.key.length - a.key.length)[0];
  const word = (text: string, value: string) =>
    new RegExp(
      `(^|[^A-Za-z0-9-])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9-])`,
    ).test(text);

  for (const entry of pipelineConventionDefaults) {
    const row = rowOf(entry.path);
    expect(row, entry.path).toBeDefined();
    if (row === undefined) continue;
    if ("from" in entry) {
      expect(row.fallback, entry.path).toContain(`\`${entry.from.split(".").pop()}\``);
      continue;
    }
    // The default column states the default; the `idempotency.*` ones, under an unset key, are in its meaning.
    const text = entry.within === undefined ? row.fallback : row.meaning;
    const member = entry.path.slice(row.key.length + 1);
    if (entry.within !== undefined) expect(row.fallback, entry.path).toMatch(/^unset/);
    const value = entry.value;
    // A default stated in prose names its member: "`enforce` is `boundary`".
    if (text.includes(`\`${member}\` is `))
      expect(text, entry.path).toContain(`\`${member}\` is \`${String(value)}\``);
    if (entry.path.startsWith("ops.")) {
      // The defaults of the `ops` table of section 6: method and path, and the success status.
      const [, op = "", field = ""] = entry.path.split(".");
      const [, , route = "", , , success = ""] = ops.find(([name]) => name === `\`${op}\``) ?? [];
      if (field === "method")
        expect(route, entry.path).toContain(`${String(value).toUpperCase()} /`);
      if (field === "path")
        expect(route.split(",")[0], entry.path).toMatch(
          value === "" ? /\/tasks(\/\{taskId\})?`$/ : /\/batch`$/,
        );
      if (field === "status")
        expect(success, entry.path).toMatch(new RegExp(`^\`${String(value)}\``));
    } else if (entry.path.startsWith("errors.derived.")) {
      expect(row.fallback, entry.path).toContain("ADR 0006 section 6");
    } else if (typeof value === "string") {
      // An object default written as `{ member: value, ... }` names the member beside its value.
      if (member !== "" && text.includes(`${member}:`))
        expect(text, entry.path).toContain(`${member}: ${value}`);
      else expect(word(text, value), `${entry.path}: ${value}`).toBe(true);
    } else if (typeof value === "boolean") {
      expect(text, entry.path).toContain(`\`${String(value)}\``);
    } else if (Array.isArray(value) && value.length > 0) {
      for (const item of value)
        expect(word(text, String(item)), `${entry.path}: ${item}`).toBe(true);
    } else {
      // An empty list or map.
      expect(row.fallback, entry.path).toMatch(/^empty/);
    }
  }
  // Every row that states a default has one in the table, under its key.
  for (const row of table.filter((r) => !/^(none|unset)/.test(r.fallback)))
    expect(
      pipelineConventionDefaults.some(
        (d) => d.path === row.key || d.path.startsWith(`${row.key}.`),
      ),
      row.key,
    ).toBe(true);
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
