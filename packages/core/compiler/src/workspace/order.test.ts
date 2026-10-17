import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import { loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import { WORKSPACE_RELAY_CYCLE_RULE, workspaceRelayOrder } from "./order.js";

// An api file whose `svc` surface holds one relay route per target (`<api>.<operationId>`).
const apiFile = (name: string, relays: readonly string[]) => {
  const routes = relays.map((target, i) => `      relay${i}: { relays: ${target} }\n`).join("");

  return `api: { name: ${name}, version: 1 }\nsurfaces:\n  svc:\n    routes:\n      ping: { method: get }\n${routes}`;
};

// A workspace of the given apis, in this order, each with its relay targets.
function workspaceOf(apis: Readonly<Record<string, readonly string[]>>): RawWorkspace {
  const entries = Object.keys(apis)
    .map((name) => `    ${name}: ./${name}.yaml\n`)
    .join("");
  const files: Record<string, string> = {
    "workspace.yaml": `workspace:\n  apis:\n${entries}  imports:\n    billing: { package: "@acme/billing", version: 1.0.0, api: billing, integrity: sha256-x }\n`,
  };

  for (const [name, relays] of Object.entries(apis)) files[`${name}.yaml`] = apiFile(name, relays);
  const loaded = loadWorkspace({ reader: loadMemoryReader(files), entry: "workspace.yaml" });

  expect(loaded.diagnostics).toEqual([]);

  return loaded.workspace;
}

const relayPointer = (index: number) => `/surfaces/svc/routes/relay${index}/relays`;

describe("relay order follows relays", () => {
  test.each([
    {
      name: "no relay keeps workspace order",
      apis: { c: [], a: [], b: [] },
      order: ["c", "a", "b"],
      relaysTo: { c: [], a: [], b: [] },
    },
    {
      name: "a chain",
      apis: { a: ["b.get"], b: ["c.get"], c: [] },
      order: ["c", "b", "a"],
      relaysTo: { a: ["b"], b: ["c"], c: [] },
    },
    {
      name: "a diamond",
      apis: { top: ["left.get", "right.get"], left: ["base.get"], right: ["base.get"], base: [] },
      order: ["base", "left", "right", "top"],
      relaysTo: { top: ["left", "right"], left: ["base"], right: ["base"], base: [] },
    },
    {
      name: "a relay to an import or to no api is not ordered",
      apis: { a: ["billing.getInvoice", "nowhere.get", "b.get", "b.list"], b: [] },
      order: ["b", "a"],
      relaysTo: { a: ["b"], b: [] },
    },
  ])("$name", ({ apis, order, relaysTo }) => {
    const relay = workspaceRelayOrder(workspaceOf(apis));

    expect(relay.order).toEqual(order);
    expect(Object.fromEntries(relay.relaysTo)).toEqual(relaysTo);
    expect(relay.diagnostics).toEqual([]);
  });
});

describe("relay cycles are refused", () => {
  test.each([
    { name: "two apis", apis: { a: ["b.get"], b: ["a.get"], c: [] }, cycle: ["a", "b"] },
    {
      name: "three apis",
      apis: { a: ["b.get"], b: ["c.get"], c: ["a.get"] },
      cycle: ["a", "b", "c"],
    },
    { name: "an api relaying to itself", apis: { a: ["a.get"], b: [] }, cycle: ["a"] },
  ])("$name", ({ apis, cycle }) => {
    const relay = workspaceRelayOrder(workspaceOf(apis));
    const names = cycle.map((api) => `'${api}'`).join(", ");

    expect(relay.diagnostics.map((entry) => entry.api)).toEqual(cycle);
    expect(new Set(relay.order)).toEqual(new Set(Object.keys(apis)));
    expect(relay.relaysTo.get("a")).toEqual(Object.values(apis)[0]?.map((t) => t.split(".")[0]));

    for (const entry of relay.diagnostics) {
      expect(entry.diagnostics).toHaveLength(1);
      expect(entry.diagnostics[0]?.rule).toBe(WORKSPACE_RELAY_CYCLE_RULE);
      expect(entry.diagnostics[0]?.message).toContain(`between the apis ${names},`);
    }
  });

  test("an api that relays into a cycle comes after it and is not part of it", () => {
    const relay = workspaceRelayOrder(workspaceOf({ d: ["a.get"], a: ["b.get"], b: ["a.get"] }));

    expect(relay.order).toEqual(["a", "b", "d"]);
    expect(relay.diagnostics.map((entry) => entry.api)).toEqual(["a", "b"]);
  });

  test("a relay route with no source location is an internal error naming it", () => {
    const workspace = workspaceOf({ a: ["b.get"], b: [] });
    const [first, second] = workspace.apis;
    const unlocated: RawApi = { ...(first as RawApi), leafOrigins: {}, layers: [] };

    expect(() =>
      workspaceRelayOrder({ ...workspace, apis: [unlocated, second as RawApi] }),
    ).toThrow(`api 'a' has no source location for ${relayPointer(0)}`);
  });
});

describe("finalize diagnostics are located", () => {
  test("a relay cycle is located at each api's relay route, the others related through their own tables", () => {
    const workspace = workspaceOf({ a: ["b.get"], b: ["c.get"], c: ["a.get"] });
    const relay = workspaceRelayOrder(workspace);

    for (const { api, diagnostics } of relay.diagnostics) {
      const raw = workspace.apis.find((candidate) => candidate.name === api);
      const [diagnostic] = diagnostics;

      expect(diagnostic?.origin).toEqual({ layer: "api", pointer: relayPointer(0) });
      expect(
        Object.hasOwn(
          raw?.locations ?? {},
          diagnosticLocationKey(diagnostic?.origin ?? { layer: "core", pointer: "" }),
        ),
      ).toBe(true);
      expect(diagnostic?.fix).not.toBe("");
      expect(diagnostic?.related.map((related) => related.origin.api)).toEqual(
        ["a", "b", "c"].filter((other) => other !== api),
      );

      for (const related of diagnostic?.related ?? []) {
        const relatedRaw = workspace.apis.find(
          (candidate) => candidate.name === related.origin.api,
        );

        expect(related.origin.layer).not.toBe("core");
        expect(
          Object.hasOwn(relatedRaw?.locations ?? {}, diagnosticLocationKey(related.origin)),
        ).toBe(true);
      }
    }
  });
});
