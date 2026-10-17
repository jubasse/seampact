import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ContractIR, IR_REVISION } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { loadFsReader } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import type { DraftIR } from "./draft.js";
import {
  draftFixtureApply,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "./draft-fixture.js";
import { DraftAccessError } from "./guard.js";
import { type HalfName, pipelineHalves } from "./halves.js";
import { compileWorkspace, type PipelineOptions } from "./orchestrator.js";
import type { DraftField } from "./ownership.js";
import type { PassContext, PassParts, TreeSchemaService, WorkspacePass } from "./pass.js";
import { isJsonObject } from "./pointer.js";
import type { PipelineFinalize, PipelineRelayStage } from "./stages.js";
import { pipelineTreeNodes } from "./tree.js";
import { PipelineReadonlyError, pipelineCopy } from "./view.js";

const REFERENCE = fileURLToPath(new URL("../../../../../fixtures/reference", import.meta.url));
const MINIMAL_IR: ContractIR = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../spec/schemas/ir/examples/minimal.ir.json", import.meta.url)),
    "utf8",
  ),
);

const api = (name: string) =>
  `api: { name: ${name}, version: 1 }\nsurfaces:\n  app:\n    prefix: /${name}\n    tags: [${name}]\n    routes:\n      ping: { method: get }\n`;
const FILES = {
  "workspace.yaml": "workspace:\n  apis:\n    a: ./a.yaml\n    b: ./b.yaml\n    c: ./c.yaml\n",
  "a.yaml": api("a"),
  "b.yaml": api("b"),
  "c.yaml": api("c"),
};
const PING = "/surfaces/app/routes/ping";

// b relays to a; c is independent.
const relayOrder: PipelineRelayStage = () => ({
  order: ["a", "b", "c"],
  relaysTo: new Map([["b", ["a"]]]),
  diagnostics: [],
});

const diagnostic = (
  severity: Diagnostic["severity"],
  rule: string,
  pointer: string,
): Diagnostic => ({
  severity,
  rule,
  message: rule,
  fix: "none",
  origin: { layer: "api", pointer },
  related: [],
});

type Act = (draft: DraftIR, context: PassContext) => void;
const NO_SCHEMAS: TreeSchemaService = {
  typeUse: () => undefined,
  queryWire: () => undefined,
  checkExample: () => [],
};

// Fake halves that log `<api>:<half>` and run `acts[half]`; each declares nothing but `writes[half]`.
function fakeParts(
  log: string[],
  acts: Partial<Record<HalfName, Act>> = {},
  writes: Partial<Record<HalfName, DraftField[]>> = {},
): PassParts {
  const body =
    (half: HalfName) =>
    (draft: DraftIR, context: PassContext): undefined => {
      log.push(`${context.raw.name}:${half}`);
      acts[half]?.(draft, context);
    };

  const declared = (half: HalfName) => ({ reads: [], writes: writes[half] ?? [] });

  return {
    "tree.schemas": {
      pass: "tree",
      half: "tree.schemas",
      ...declared("tree.schemas"),
      run: (draft, context) => {
        body("tree.schemas")(draft, context);

        return NO_SCHEMAS;
      },
    },
    "tree.nodes": {
      pass: "tree",
      half: "tree.nodes",
      ...declared("tree.nodes"),
      run: body("tree.nodes"),
    },
    "access.identity": {
      pass: "access",
      half: "access.identity",
      ...declared("access.identity"),
      run: body("access.identity"),
    },
    "access.rights": {
      pass: "access",
      half: "access.rights",
      ...declared("access.rights"),
      run: body("access.rights"),
    },
    "derive.wire": {
      pass: "derive",
      half: "derive.wire",
      ...declared("derive.wire"),
      run: body("derive.wire"),
    },
    "derive.errors": {
      pass: "derive",
      half: "derive.errors",
      ...declared("derive.errors"),
      run: body("derive.errors"),
    },
  };
}

function compile(
  log: string[],
  acts: Partial<Record<HalfName, Act>> = {},
  extra: Partial<PipelineOptions["parts"]> = {},
  options: Partial<PipelineOptions> = {},
) {
  const link: WorkspacePass = {
    name: "link",
    reads: [],
    run: (apis) => {
      log.push(`link:${[...apis.keys()].join(",")}`);
    },
  };
  const finalize: PipelineFinalize = (_draft, context) => {
    log.push(`${context.raw.name}:finalize`);

    return undefined;
  };

  return compileWorkspace({
    reader: loadMemoryReader(FILES),
    entry: "workspace.yaml",
    guard: true,
    parts: { passes: fakeParts(log, acts), relayOrder, link, finalize, ...extra },
    ...options,
  });
}

const ALL = (name: string) =>
  [
    "tree.schemas",
    "tree.nodes",
    "access.identity",
    "access.rights",
    "derive.wire",
    "derive.errors",
  ].map((half) => `${name}:${half}`);
const byApi = (result: ReturnType<typeof compile>) =>
  Object.fromEntries(result.apis.map((r) => [r.api, r.diagnostics.map((d) => d.rule)]));

describe("stop rule", () => {
  test("halves in order, an erroring half completes, dependents skipped, independent apis continue", () => {
    const log: string[] = [];
    const result = compile(log, {
      "access.identity": (_draft, context) => {
        if (context.raw.name !== "a") return;
        context.report(diagnostic("error", "x/second", PING));
        context.report(diagnostic("error", "x/first", "/api"));
        log.push("a:access.identity:completed");
      },
    });

    expect(log).toEqual([
      "a:tree.schemas",
      "a:tree.nodes",
      "a:access.identity",
      "a:access.identity:completed",
      ...ALL("c"),
    ]);
    // Every error of the step, sorted by location (ADR 0006 section 4); b is skipped with no diagnostic.
    expect(byApi(result)).toEqual({ a: ["x/first", "x/second"], b: [], c: [] });
    expect(result.diagnostics).toEqual([]);
  });

  test("warnings never stop; link and finalize run when no api has an error", () => {
    const log: string[] = [];
    const finalize: PipelineFinalize = (draft, context) => {
      log.push(`${context.raw.name}:finalize`);
      expect(draft.operations).toEqual([]);

      return { ir: MINIMAL_IR, sourceMap: { irRevision: IR_REVISION, locations: {} } };
    };

    const result = compile(
      log,
      { "tree.nodes": (_d, c) => c.report(diagnostic("warning", "x/warn", PING)) },
      { finalize },
    );

    expect(log).toEqual([
      ...ALL("a"),
      ...ALL("b"),
      ...ALL("c"),
      "link:a,b,c",
      "a:finalize",
      "b:finalize",
      "c:finalize",
    ]);
    expect(byApi(result)).toEqual({ a: ["x/warn"], b: ["x/warn"], c: ["x/warn"] });
    expect(result.apis.map((r) => r.ir)).toEqual([MINIMAL_IR, MINIMAL_IR, MINIMAL_IR]);
  });

  test("a link error stops finalize; a finalize error drops that api's IR", () => {
    const log: string[] = [];
    const link: WorkspacePass = {
      name: "link",
      reads: [],
      run: (_apis, context) => {
        context.report("b", diagnostic("error", "link/superset", PING));
        expect(() => context.report("nope", diagnostic("error", "x", PING))).toThrow(/nope/);
      },
    };

    expect(byApi(compile(log, {}, { link }))).toEqual({ a: [], b: ["link/superset"], c: [] });
    expect(log.some((line) => line.endsWith(":finalize"))).toBe(false);

    const finalize: PipelineFinalize = (_draft, context) => {
      if (context.raw.name === "c") context.report(diagnostic("error", "finalize/collision", PING));

      return { ir: MINIMAL_IR, sourceMap: { irRevision: IR_REVISION, locations: {} } };
    };

    const result = compile([], {}, { finalize });

    expect(result.apis.map((r) => r.ir === undefined)).toEqual([false, false, true]);
  });

  test("a relay order error stops its api and the apis relaying to it", () => {
    const log: string[] = [];
    const failing: PipelineRelayStage = (workspace) => ({
      ...relayOrder(workspace),
      diagnostics: [{ api: "a", diagnostics: [diagnostic("error", "finalize/relay-cycle", PING)] }],
    });
    const result = compile(log, {}, { relayOrder: failing });

    expect(log).toEqual(ALL("c"));
    expect(byApi(result)).toEqual({ a: ["finalize/relay-cycle"], b: [], c: [] });
  });

  test("a relay order that misses an api, repeats one or names another throws", () => {
    for (const order of [
      ["a", "b"],
      ["a", "b", "b"],
      ["a", "b", "x"],
    ]) {
      const wrong: PipelineRelayStage = (workspace) => ({ ...relayOrder(workspace), order });

      expect(() => compile([], {}, { relayOrder: wrong }), order.join(",")).toThrow(
        /every workspace api once, and no other name/,
      );
    }
  });

  test("finalize's report closes when finalize returns; link reads one view per import", () => {
    let late: ((diagnostic: Diagnostic) => void) | undefined;
    const finalize: PipelineFinalize = (_draft, context) => {
      late = context.report;

      return undefined;
    };

    compile([], {}, { finalize });
    expect(() => late?.(diagnostic("error", "x/late", PING))).toThrow(/after its run ended/);

    const seen: unknown[] = [];
    const link: WorkspacePass = {
      name: "link",
      reads: [],
      run: (_apis, context) => {
        seen.push(context.imported("ext"), context.imported("ext"));
      },
    };

    compile([], {}, { link }, { imports: new Map([["ext", MINIMAL_IR]]) });
    expect(seen[0]).toBeDefined();
    expect(seen[0]).toBe(seen[1]);
  });

  test("load stops on an error, validate on any diagnostic", () => {
    const log: string[] = [];
    const missing = compileWorkspace({
      reader: loadMemoryReader({}),
      entry: "workspace.yaml",
      parts: { passes: fakeParts(log) },
    });

    expect(missing.diagnostics.length).toBeGreaterThan(0);
    expect(missing.apis).toEqual([]);
    // The files the load tried to read come back on the early return too (the watch primitive needs them).
    expect(missing.files).toEqual(["workspace.yaml"]);

    const invalid = compileWorkspace({
      reader: loadMemoryReader({ ...FILES, "c.yaml": `${api("c")}unknownKey: 1\n` }),
      entry: "workspace.yaml",
      parts: { passes: fakeParts(log) },
    });

    expect(log).toEqual([]);
    expect(invalid.apis.map((r) => [r.api, r.diagnostics.length > 0])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
  });

  test("the default stubs compile the reference contract without a diagnostic", () => {
    for (const guard of [false, true]) {
      const result = compileWorkspace({
        reader: loadFsReader(REFERENCE),
        entry: "workspace.yaml",
        guard,
        // The derive halves are stubs until their lanes land, so finalize would refuse the incomplete draft.
        parts: { passes: { "tree.schemas": referenceTreeSchemas }, finalize: () => undefined },
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.apis.map((r) => [r.api, r.diagnostics, r.ir])).toEqual([
        ["tasks", [], undefined],
        ["tasksService", [], undefined],
      ]);
      expect(Object.keys(result.locations).length).toBeGreaterThan(0);
      expect(result.files).toContain("workspace.yaml");
      expect(result.files).toEqual([...result.files].sort());
    }
  });
});

// tree.schemas as its fixture writes it for the reference contract: the after-tree schemas and enums, and the
// schema service answering the reference contract's route positions, principals and headers. The halves after it
// that are no longer stubs read both.
const referenceTreeSchemas: PassParts["tree.schemas"] = {
  pass: "tree",
  half: "tree.schemas",
  reads: [],
  writes: ["schemas", "scalars", "enums", "extensionKeys"],
  run: (draft, context) => {
    const api = context.raw.name;

    if (api !== "tasks" && api !== "tasksService")
      throw new Error(`the reference contract has no api ${api}`);

    for (const { half, members } of draftFixtureHalves(api, "after-tree"))
      if (half === "tree.schemas") draftFixtureApply(draft, members);

    return draftFixtureSchemaService(api);
  },
};

describe("guarded run", () => {
  test("an undeclared write throws, and each half's guard ends with its run", () => {
    expect(() =>
      compile([], {
        "tree.nodes": (draft) => {
          draft.lint = { rules: {}, allows: [] };
        },
      }),
    ).toThrow(DraftAccessError);

    let kept: DraftIR | undefined;

    expect(() =>
      compile([], {
        "tree.schemas": (draft) => {
          kept = draft;
        },
        "tree.nodes": () => kept?.operations,
      }),
    ).toThrow(/revoked/);
  });

  // A strict-mode assignment, which a frozen object refuses with a TypeError.
  const poke = (target: unknown, key: string): void => {
    (target as Record<string, unknown>)[key] = 1;
  };

  const ext: ContractIR = structuredClone(MINIMAL_IR);

  test.each<[string, Act, ErrorConstructor | typeof PipelineReadonlyError]>([
    ["raw", (_d, c) => poke(c.raw.merged, "surfaces"), PipelineReadonlyError],
    ["raw layers", (_d, c) => poke(c.raw.layers, "length"), PipelineReadonlyError],
    ["workspace", (_d, c) => poke(c.workspace, "root"), PipelineReadonlyError],
    [
      "relayed",
      (_d, c) => {
        if (c.raw.name === "b") poke(c.relayed("a"), "operations");
      },
      PipelineReadonlyError,
    ],
    ["imported", (_d, c) => poke(c.imported("ext"), "irRevision"), PipelineReadonlyError],
    [
      "inherited entry",
      (_d, c) => {
        const ping = pipelineTreeNodes(c.raw).find((n) => n.name === "ping");

        poke(ping && c.inherited(ping, "tags")?.entries[0], "value");
      },
      TypeError,
    ],
    [
      "inherited value",
      (_d, c) => {
        const app = pipelineTreeNodes(c.raw)[0];

        poke(app && c.inherited(app, "tags")?.entries[0]?.node.settings.tags, "0");
      },
      PipelineReadonlyError,
    ],
  ])("with the guard on, %s is read-only", (_source, act, error) => {
    const run = (guard: boolean) =>
      compile([], { "access.identity": act }, {}, { guard, imports: new Map([["ext", ext]]) });

    expect(() => run(true)).toThrow(error);
  });
});

describe("schema service", () => {
  test("every half after tree.schemas receives the service tree.schemas returned", () => {
    const received: Partial<Record<HalfName, unknown>> = {};
    const record =
      (half: HalfName): Act =>
      (_draft, context) => {
        received[half] = Reflect.get(context, "treeSchemas");
      };

    const acts = Object.fromEntries(pipelineHalves.map((half) => [half, record(half)]));

    compile([], {}, { passes: fakeParts([], acts) });
    expect(received["tree.schemas"]).toBeUndefined();

    for (const half of pipelineHalves.slice(1)) expect(received[half], half).toBe(NO_SCHEMAS);
  });
});

describe("guard on and off", () => {
  // Halves that store copies of what they read (the raw tree, an inherited node's settings, another api's draft),
  // then change their copies; finalize reports what it sees of each draft and raw tree.
  const rename = (value: unknown, name: string): void => {
    if (typeof value === "object" && value !== null) Reflect.set(value, "name", name);
  };

  const acts: Partial<Record<HalfName, Act>> = {
    "tree.nodes": (draft, context) => {
      const api = pipelineCopy(context.raw.merged.api);
      const surface = pipelineTreeNodes(context.raw)[0];
      const settings = surface && pipelineCopy(surface.settings);
      const relayed = context.relayed("a")?.operations[0];

      draft.operations.push({ examples: { api: { value: api }, settings: { value: settings } } });

      if (relayed !== undefined) draft.operations.push(pipelineCopy(relayed));
      rename(api, "changed");

      if (settings !== undefined && isJsonObject(settings)) Reflect.set(settings, "prefix", "/x");
      rename(draft.operations[1]?.examples?.api?.value, `${context.raw.name}-changed`);
    },
  };
  const finalize: PipelineFinalize = (draft, context) => {
    const seen = JSON.stringify({ operations: draft.operations, merged: context.raw.merged });

    context.report({ ...diagnostic("warning", "x/seen", "/api"), message: seen });

    return undefined;
  };

  const run = (guard: boolean) =>
    compile(
      [],
      {},
      {
        passes: fakeParts([], acts, { "tree.nodes": ["operations[].examples"] }),
        finalize,
      },
      { guard },
    );

  test("a run gives byte-equal results with the guard off and on", () => {
    const off = run(false);

    expect(JSON.stringify(off)).toBe(JSON.stringify(run(true)));
    // Nothing a half changed in its copies reached the raw tree or another api's draft.
    const seen = (api: string) =>
      JSON.parse(off.apis.find((r) => r.api === api)?.diagnostics[0]?.message ?? "null");

    expect(seen("a").merged.api.name).toBe("a");
    expect(seen("a").merged.surfaces.app.prefix).toBe("/a");
    expect(seen("a").operations[0].examples.api.value.name).toBe("changed");
    expect(seen("a").operations).toHaveLength(1);
    expect(seen("b").operations[1].examples.api.value.name).toBe("b-changed");
  });
});
