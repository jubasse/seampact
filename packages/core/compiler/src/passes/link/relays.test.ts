import { fileURLToPath } from "node:url";
import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { derivationTable } from "../../derivations/index.js";
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import { loadFsReader } from "../../load/index.js";
import { compileWorkspace } from "../../pipeline/orchestrator.js";
import type { DraftIR, WorkspacePassContext } from "../../pipeline/seam.js";
import type { RawWorkspace } from "../../raw-tree.js";
import { deriveErrorsRunContract } from "../derive/errors/test-support.js";
import {
  deriveWireReferenceVariants,
  deriveWireReferenceWorkspace,
} from "../derive/wire/test-support.js";
import { LINK_GATEWAY_DERIVATIONS, LINK_RELAY_SUPERSET_RULE, linkPass } from "./index.js";

const REFERENCE = fileURLToPath(new URL("../../../../../../fixtures/reference", import.meta.url));
const RELAY_ROUTE = "/surfaces/internal/routes/getTask";

// The derived drafts of both reference apis, the service run reading the public api's draft as its relay source.
function derivedApis(workspace: RawWorkspace): Map<string, DraftIR> {
  const publicRun = deriveErrorsRunContract(workspace, { api: "tasks" });
  const serviceRun = deriveErrorsRunContract(workspace, {
    api: "tasksService",
    relayed: new Map([["tasks", publicRun.draft]]),
  });

  expect([...publicRun.diagnostics, ...serviceRun.diagnostics]).toEqual([]);

  return new Map([
    ["tasks", publicRun.draft],
    ["tasksService", serviceRun.draft],
  ]);
}

function runLink(
  apis: ReadonlyMap<string, DraftIR>,
  workspace: RawWorkspace,
  imports: ReadonlyMap<string, ContractIR> = new Map(),
): [string, Diagnostic][] {
  const reported: [string, Diagnostic][] = [];
  const context: WorkspacePassContext = {
    workspace,
    imported: (api) => imports.get(api),
    report: (api, diagnostic) => reported.push([api, diagnostic]),
  };

  linkPass.run(apis, context);

  return reported;
}

const operationOf = (draft: DraftIR | undefined, id: string) =>
  draft?.operations.find((candidate) => candidate.id === id);

// The service api binds schemaInvalid to its own code, which the public api does not answer.
const serviceOwnInvalid = () =>
  deriveWireReferenceVariants({
    "tasks-service/api.yaml": [
      [
        "\nsurfaces:\n",
        "\nerrors:\n  service.invalid: { status: 400, nature: refused, params: { issues: Issues } }\n\nconventions:\n  errors:\n    derived:\n      schemaInvalid:\n        code: service.invalid\n        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }\n\nsurfaces:\n",
      ],
    ],
  });

describe("relays superset", () => {
  test("the reference relay route answers every code of its public operation", () => {
    const workspace = deriveWireReferenceWorkspace();

    expect(runLink(derivedApis(workspace), workspace)).toEqual([]);
  });

  test("a code the gateway answers itself need not be answered by the relay route, any other must", () => {
    const workspace = deriveWireReferenceWorkspace();
    const apis = derivedApis(workspace);
    const publicErrors = operationOf(apis.get("tasks"), "getTask")?.errors;

    if (publicErrors === undefined) throw new Error("the reference tasks.getTask has no errors");

    for (const derivation of LINK_GATEWAY_DERIVATIONS)
      publicErrors.push({ code: `gateway.${derivation}`, derivedFrom: { derivation, from: [] } });

    publicErrors.push({
      code: "tasks.locked",
      derivedFrom: { derivation: "node.errors", from: [] },
    });

    expect(runLink(apis, workspace).map(([, diagnostic]) => diagnostic.message)).toEqual([
      "The relay route tasksService.getTask does not answer the code 'tasks.locked', which tasks.getTask answers.",
    ]);
  });

  test("a boundary role bound to different codes names both operations, the code, the role and the fix", () => {
    const workspace = serviceOwnInvalid();
    const reported = runLink(derivedApis(workspace), workspace);

    expect(reported.map(([api, diagnostic]) => [api, diagnostic.rule, diagnostic.origin])).toEqual([
      [
        "tasksService",
        LINK_RELAY_SUPERSET_RULE,
        { layer: "api", pointer: `${RELAY_ROUTE}/relays` },
      ],
    ]);
    expect(reported[0]?.[1]).toMatchObject({
      severity: "error",
      message:
        "The relay route tasksService.getTask does not answer the code 'api.schema_invalid', which tasks.getTask answers for the role 'schemaInvalid'.",
      fix: "Bind the role to the same code in both apis, for the api with `conventions.errors.derived` or with `errorRoles` on the relay route.",
    });
  });

  test("an imported public operation is read from its IR", () => {
    const workspace = serviceOwnInvalid();
    const service = derivedApis(workspace).get("tasksService");
    const compiled = compileWorkspace({ reader: loadFsReader(REFERENCE), entry: "workspace.yaml" });
    const publicIr = compiled.apis.find((entry) => entry.api === "tasks")?.ir;

    if (service === undefined || publicIr === undefined)
      throw new Error("the reference compiles no tasks IR or no tasksService draft");

    const reported = runLink(
      new Map([["tasksService", service]]),
      workspace,
      new Map([["tasks", publicIr]]),
    );

    expect(reported.map(([, diagnostic]) => diagnostic.message)).toEqual([
      "The relay route tasksService.getTask does not answer the code 'api.schema_invalid', which tasks.getTask answers for the role 'schemaInvalid'.",
    ]);
  });

  test("a relay naming neither a workspace operation nor an import is an internal error", () => {
    const workspace = deriveWireReferenceWorkspace();
    const service = derivedApis(workspace).get("tasksService");

    if (service === undefined) throw new Error("the reference derives no tasksService draft");

    expect(() => runLink(new Map([["tasksService", service]]), workspace)).toThrow(
      /relays tasks\.getTask, which tree\.nodes found but is no closed operation/,
    );
  });

  test("every gateway derivation is a row of the derivation table", () => {
    const rows = new Set(derivationTable.map((row) => row.id));

    expect(LINK_GATEWAY_DERIVATIONS.filter((id) => !rows.has(id))).toEqual([]);
  });
});
