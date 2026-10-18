import { type ContractIR, IR_REVISION } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR, DraftOperation } from "../../../pipeline/seam.js";
import { deriveWireReferenceVariants } from "../wire/test-support.js";
import {
  deriveErrorsLoadThreeApis,
  deriveErrorsLocated,
  deriveErrorsReferenceWorkspace,
  deriveErrorsRunContract,
  deriveErrorsRunReference,
} from "./test-support.js";

const PUBLIC_GET = "/surfaces/app/routes/channels/member/routes/tasks/ops/get";
const RELAY_POINTER = "/surfaces/internal/routes/getTask/relays";

function operationOf(draft: DraftIR, id: string): DraftOperation {
  const operation = draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the draft has no operation ${id}`);

  return operation;
}

const errorOf = (draft: DraftIR, id: string, code: string) =>
  operationOf(draft, id).errors?.find((candidate) => candidate.code === code);

// The reference workspace whose tasks collection declares `tasks.locked` (with `declaration` inside the braces) on
// the contract nature `locked`, its service api holding `serviceErrors`.
function lockedWorkspace(declaration: string, serviceErrors = "") {
  return deriveWireReferenceVariants({
    "tasks/api.yaml": [
      ["\nschemas:\n", "\nnatures:\n  locked: { base: refused }\n\nschemas:\n"],
      [
        "              item: Task\n",
        `              item: Task\n              errors: { tasks.locked: { status: 423, nature: locked${declaration} } }\n`,
      ],
    ],
    "tasks-service/api.yaml": [["\nsurfaces:\n", `\n${serviceErrors}surfaces:\n`]],
  });
}

function relayRun(declaration: string, serviceErrors = "") {
  const workspace = lockedWorkspace(declaration, serviceErrors);
  const publicRun = deriveErrorsRunContract(workspace, { api: "tasks" });

  expect(publicRun.diagnostics).toEqual([]);

  return {
    publicRun,
    serviceRun: deriveErrorsRunContract(workspace, {
      api: "tasksService",
      relayed: new Map([["tasks", publicRun.draft]]),
    }),
  };
}

describe("relay routes copy domain codes", () => {
  test("a relay route copies notFound with its roles, derived from the public operation in its api", () => {
    const workspace = deriveErrorsReferenceWorkspace();
    const publicError = errorOf(
      deriveErrorsRunReference(workspace, "tasks").draft,
      "getTask",
      "api.not_found",
    );
    const service = deriveErrorsRunReference(workspace, "tasksService");

    expect(service.diagnostics).toEqual([]);
    expect(errorOf(service.draft, "getTask", "api.not_found")).toEqual({
      code: "api.not_found",
      roles: publicError?.roles,
      derivedFrom: {
        derivation: "relay.route",
        from: [{ api: "tasks", layer: "api", pointer: PUBLIC_GET }],
      },
    });
    expect(errorOf(service.draft, "getTask", "api.unauthenticated")?.derivedFrom?.from).toEqual([
      { layer: "api", pointer: "/api/caller/identity" },
    ]);
  });

  test("a node's code joins this api with its declaration and contract nature, origins in the public api", () => {
    const { serviceRun } = relayRun("");

    expect(serviceRun.diagnostics).toEqual([]);
    expect(serviceRun.draft.errors["tasks.locked"]).toMatchObject({
      natureName: "locked",
      origin: { api: "tasks", layer: "api" },
    });
    expect(serviceRun.draft.natures.locked?.origin).toMatchObject({ api: "tasks", layer: "api" });
    expect(errorOf(serviceRun.draft, "getTask", "tasks.locked")).toMatchObject({
      origin: { api: "tasks", layer: "api" },
      derivedFrom: { derivation: "relay.route" },
    });
  });

  test("a copied code whose params schema this api lacks is refused at the relay route", () => {
    const { serviceRun } = relayRun(", params: { holder: { type: string } }");

    expect(serviceRun.diagnostics.map(deriveErrorsLocated)).toEqual([
      { rule: "seampact/derive/relay-declaration", pointer: RELAY_POINTER, related: [] },
    ]);
    expect(errorOf(serviceRun.draft, "getTask", "tasks.locked")).toBeUndefined();
  });

  test("a copied code this api declares differently is refused, naming this api's declaration", () => {
    const { serviceRun } = relayRun("", "errors:\n  tasks.locked: { status: 423 }\n\n");

    expect(serviceRun.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/relay-declaration",
        pointer: RELAY_POINTER,
        related: ["/errors/tasks.locked"],
      },
    ]);
  });
});

// The public api's derived draft as an imported IR.
const importedIr = (draft: DraftIR): ContractIR =>
  JSON.parse(
    JSON.stringify({
      irVersion: "1.0",
      irRevision: IR_REVISION,
      kinds: [],
      features: [],
      ...draft,
    }),
  );

describe("relay routes copy contract natures", () => {
  test("a copied nature this api declares on another base is refused, naming this api's nature", () => {
    const { serviceRun } = relayRun("", "natures:\n  locked: { base: unavailable }\n\n");

    expect(serviceRun.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/relay-declaration",
        pointer: RELAY_POINTER,
        related: ["/natures/locked"],
      },
    ]);
    expect(errorOf(serviceRun.draft, "getTask", "tasks.locked")).toBeUndefined();
  });
});

describe("relay routes to an imported api", () => {
  test("a code this api declares the same is copied; one it lacks is refused, not copied", () => {
    const workspace = lockedWorkspace("");
    const publicRun = deriveErrorsRunContract(workspace, { api: "tasks" });
    const serviceRun = deriveErrorsRunContract(workspace, {
      api: "tasksService",
      imports: new Map([["tasks", importedIr(publicRun.draft)]]),
    });

    expect(serviceRun.diagnostics.map(deriveErrorsLocated)).toEqual([
      { rule: "seampact/derive/relay-declaration", pointer: RELAY_POINTER, related: [] },
    ]);
    expect(errorOf(serviceRun.draft, "getTask", "api.not_found")?.derivedFrom?.derivation).toBe(
      "relay.route",
    );
    expect(errorOf(serviceRun.draft, "getTask", "tasks.locked")).toBeUndefined();
  });
});

const SECOND_RELAY_POINTER = "/surfaces/internal/routes/health/relays";

// Two public apis declare `tasks.locked` on a node (the tasks collection, the second api's `health` route), each with
// its own status and its own base of the nature `locked`; the service relays one route of each.
function twoPublicRun(first: { status: number; base: string }, second: typeof first) {
  const declare = (
    { status, base }: typeof first,
    anchor: string,
    indent: string,
  ): [string, string][] => [
    ["\nschemas:\n", `\nnatures:\n  locked: { base: ${base} }\n\nschemas:\n`],
    [anchor, `${anchor}${indent}errors: { tasks.locked: { status: ${status}, nature: locked } }\n`],
  ];
  const workspace = deriveErrorsLoadThreeApis({
    "tasks/api.yaml": declare(first, "              item: Task\n", "              "),
    "tasks-two/api.yaml": declare(second, "        output: Health\n", "        "),
  });
  const relayed = new Map(
    ["tasks", "tasksTwo"].map((api) => {
      const run = deriveErrorsRunContract(workspace, { api });

      expect(run.diagnostics).toEqual([]);

      return [api, run.draft];
    }),
  );

  return deriveErrorsRunContract(workspace, { api: "tasksService", relayed });
}

describe("relay routes of two public apis", () => {
  test("a code both declare the same is copied once and answered on both routes", () => {
    const run = twoPublicRun({ status: 423, base: "refused" }, { status: 423, base: "refused" });

    expect(run.diagnostics).toEqual([]);

    for (const id of ["getTask", "health"])
      expect(errorOf(run.draft, id, "tasks.locked")?.derivedFrom?.derivation).toBe("relay.route");
  });

  test("a code the second declares differently than the first copy is refused at the second route", () => {
    const run = twoPublicRun({ status: 423, base: "refused" }, { status: 409, base: "refused" });

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/relay-declaration",
        pointer: SECOND_RELAY_POINTER,
        related: [RELAY_POINTER],
      },
    ]);
    expect(errorOf(run.draft, "getTask", "tasks.locked")).toBeDefined();
    expect(errorOf(run.draft, "health", "tasks.locked")).toBeUndefined();
  });

  test("a nature the second declares on another base than the first copy is refused at the second route", () => {
    const run = twoPublicRun(
      { status: 423, base: "refused" },
      { status: 423, base: "unavailable" },
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/relay-declaration",
        pointer: SECOND_RELAY_POINTER,
        related: [RELAY_POINTER],
      },
    ]);
    expect(errorOf(run.draft, "health", "tasks.locked")).toBeUndefined();
  });
});
