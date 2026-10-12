import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import type { AuthoringFile } from "./schemas.js";
import { authoringAjv, schemaId } from "./test-ajv.js";

// Every YAML example of ADR 0002, ADR 0003 and ADR 0008 is validated against the kind its path or
// include site implies (requirement 5 of the lane brief).

interface Example {
  adr: string;
  index: number;
  header: string;
  text: string;
}

type Plan =
  // A file kind, or the definition of a fragment kind.
  | { schema: AuthoringFile; pointer?: string; stub?: Record<string, unknown>; wrap?: "routes" }
  | { skip: string };

const ADRS = [
  "0002-grammar.md",
  "0003-schema-language.md",
  "0008-convention-packs-and-extensions.md",
];

function examples(): Example[] {
  const out: Example[] = [];
  for (const adr of ADRS) {
    const text = readFileSync(new URL(`../../../../docs/adr/${adr}`, import.meta.url), "utf8");
    const blocks = [...text.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)];
    blocks.forEach((m, index) => {
      const body = m[1] ?? "";
      out.push({ adr, index, header: body.split("\n")[0] ?? "", text: body });
    });
  }
  return out;
}

const API_STUB = { api: { name: "excerpt", version: 1 } };
const PACK_STUB = { pack: { name: "excerpt", version: "1.0.0" } };

// The kind of each example, from its first line: the path, then the excerpt's include site.
function plan(header: string): Plan {
  if (header.startsWith("# seampact explain")) {
    return {
      skip: "the output of seampact explain, a view that nothing reads back (ADR 0002 section 16)",
    };
  }
  if (header.startsWith("# yaml-language-server:")) return { schema: "node" };
  if (header === "# fragments, one per feature")
    return { schema: "node", pointer: "/$defs/surface", wrap: "routes" };
  if (header === "# workspace.yaml") return { schema: "workspace" };
  const site = /\(excerpt(?:: ([^)]*))?\)/.exec(header);
  const path = header.slice(2).split(/[ :]/)[0] ?? "";
  if (
    path.endsWith("/api.yaml") ||
    path.endsWith("/routes.yaml") ||
    path.endsWith("/search.yaml")
  ) {
    if (path.endsWith("/search.yaml")) return { schema: "node" };
    if (site === null) return { schema: "api" };
    const where = site[1];
    if (where === undefined) return { schema: "api", stub: API_STUB };
    if (where === "route settings" || where === "two route settings") {
      return { schema: "node", pointer: "/$defs/route" };
    }
    if (where === "settings of a surface root")
      return { schema: "node", pointer: "/$defs/surface" };
    if (where === "node settings") return { schema: "node", pointer: "/$defs/scope" };
    if (where === "node settings of tasks") return { schema: "node", pointer: "/$defs/collection" };
    if (
      where === "a member route" ||
      where === "a node under routes" ||
      where.startsWith("under a surface's routes") ||
      where.startsWith("member routes of") ||
      where.startsWith("an OAuth callback")
    ) {
      return { schema: "node", pointer: "/$defs/surface", wrap: "routes" };
    }
    return { skip: `unclassified include site: ${where}` };
  }
  if (path.endsWith("base.yaml")) return { schema: "base" };
  if (path.endsWith("schemas.yaml")) return { schema: "schemas" };
  if (
    path.startsWith("packs/") ||
    path.startsWith("@seampact/pack-") ||
    header.startsWith("# the core default")
  ) {
    return { schema: "pack", stub: PACK_STUB };
  }
  return { skip: `unclassified example: ${header}` };
}

// Examples skipped on purpose, with their reason; the test fails on any other skip.
const EXPECTED_SKIPS = ["# seampact explain tasks.updateTask"];

describe("adr examples validate", () => {
  const ajv = authoringAjv();
  const all = examples();

  test("every example is classified", () => {
    const skipped = all.filter((e) => "skip" in plan(e.header)).map((e) => e.header);
    expect(skipped).toEqual(EXPECTED_SKIPS);
    expect(all.length).toBeGreaterThan(60);
  });

  test.each(all.map((e) => [`${e.adr}#${e.index} ${e.header}`, e] as const))("%s", (_, example) => {
    const p = plan(example.header);
    if ("skip" in p) return;
    const parsed = parse(example.text) as Record<string, unknown>;
    let doc: unknown = p.wrap === "routes" ? { routes: parsed } : parsed;
    const stubKey = p.stub === undefined ? undefined : Object.keys(p.stub)[0];
    if (stubKey !== undefined && !(stubKey in parsed)) doc = { ...p.stub, ...parsed };
    const validate = ajv.getSchema(schemaId(p.schema, p.pointer));
    if (validate === undefined) throw new Error(`no schema ${p.schema}${p.pointer ?? ""}`);
    validate(doc);
    expect(
      (validate.errors ?? [])
        .filter((e) => e.keyword !== "if")
        .map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`),
    ).toEqual([]);
  });
});
