import { fileURLToPath } from "node:url";
import { type ContractIR, checkIrInvariants } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { loadFsReader } from "../load/index.js";
import { compileWorkspace, type PipelineResult } from "../pipeline/orchestrator.js";
import { finalizeSerializeIr, finalizeSerializeJson } from "./serialize.js";

// The reference contract through every pass and finalize: one valid, byte-stable IR per api.

const REFERENCE = fileURLToPath(new URL("../../../../../fixtures/reference/", import.meta.url));

const compiledReference = (): PipelineResult =>
  compileWorkspace({ reader: loadFsReader(REFERENCE), entry: "workspace.yaml", guard: true });

const CATALOGUES = [
  "buckets",
  "enums",
  "errors",
  "extensionKeys",
  "formats",
  "headers",
  "identities",
  "natures",
  "pagings",
  "rights",
  "rules",
  "scalars",
  "schemas",
  "schemes",
  "scopes",
  "services",
] as const satisfies readonly (keyof ContractIR)[];

type Catalogue = (typeof CATALOGUES)[number];

const SHARED_DECLARATIONS = {
  extensionKeys: [],
  formats: ["bare"],
  headers: ["actorSurface", "deadline", "trace"],
  identities: ["service", "stripe", "user"],
  natures: [],
  scalars: [],
  schemes: ["bearer", "csrfToken", "internalToken", "sessionCookie", "stripeSignature"],
  services: [],
} as const;

// The declarations each api keeps once pruned. The tasksService `cursor` paging style is named by its conventions
// only, which reach no declaration, so it is dropped.
const EXPECTED_DECLARATIONS: Record<string, Record<Catalogue, readonly string[]>> = {
  tasks: {
    ...SHARED_DECLARATIONS,
    buckets: ["write"],
    enums: ["ReauthIntent", "Role", "Service", "Surface", "TaskState"],
    errors: [
      "api.csrf_invalid",
      "api.forbidden",
      "api.idempotency_in_progress",
      "api.idempotency_key_reused",
      "api.internal",
      "api.not_found",
      "api.payload_too_large",
      "api.rate_limited",
      "api.reauthentication_required",
      "api.schema_invalid",
      "api.unauthenticated",
      "api.unsupported_media_type",
      "state.conflict",
    ],
    pagings: ["cursor"],
    rights: ["roles", "tasks.read", "tasks.seeEffort", "tasks.update"],
    rules: ["recentAuth", "throttle"],
    schemas: [
      "ApiEmptyBody",
      "ApiForbiddenParams",
      "ApiPayloadTooLargeParams",
      "ApiRateLimitedParams",
      "ApiSchemaInvalidParams",
      "ArchiveTask",
      "AssignTaskInput",
      "Channel",
      "CreateTask",
      "Draft",
      "GetTasksBatchInput",
      "Health",
      "IssuesItem",
      "PaymentEvent",
      "Preferences",
      "RecentAuthParams",
      "RolesParams",
      "ServicePrincipal",
      "Task",
      "TaskQuery",
      "TaskSearchResult",
      "UpdatePreferences",
      "UpdateTask",
      "UserPrincipal",
      "WebhookCaller",
    ],
    scopes: ["channel"],
  },
  tasksService: {
    ...SHARED_DECLARATIONS,
    buckets: [],
    enums: ["Service", "Surface", "TaskState"],
    errors: [
      "api.deadline_exceeded",
      "api.forbidden",
      "api.internal",
      "api.not_found",
      "api.schema_invalid",
      "api.unauthenticated",
    ],
    pagings: [],
    rights: ["callerService", "tasks.seeEffort"],
    rules: [],
    schemas: [
      "ApiForbiddenParams",
      "ApiSchemaInvalidParams",
      "CallerServiceParams",
      "IssuesItem",
      "ServicePrincipal",
      "Task",
      "UserPrincipal",
      "WebhookCaller",
    ],
    scopes: [],
  },
};

function declarationsOf(ir: ContractIR): Record<string, string[]> {
  return Object.fromEntries(
    CATALOGUES.map((catalogue) => [catalogue, Object.keys(ir[catalogue]).sort()]),
  );
}

function irOf(ir: ContractIR | undefined, api: string): ContractIR {
  if (ir === undefined) throw new Error(`the reference api ${api} has no IR`);

  return ir;
}

// Each api's IR and side table as the bytes finalize writes.
const serializedApis = (result: PipelineResult): string[] =>
  result.apis.map(
    (api) =>
      `${api.api}\n${finalizeSerializeIr(irOf(api.ir, api.api))}${finalizeSerializeJson(api.sourceMap)}`,
  );

describe("the reference contract finalizes", () => {
  test("each api gives a valid IR with its expected declarations, the same bytes over two runs", () => {
    const first = compiledReference();

    expect(first.diagnostics).toEqual([]);
    expect(first.apis.map((api) => api.api)).toEqual(Object.keys(EXPECTED_DECLARATIONS));

    for (const api of first.apis) {
      const ir = irOf(api.ir, api.api);

      expect(api.diagnostics).toEqual([]);
      expect(checkIrInvariants(ir)).toEqual([]);
      expect(declarationsOf(ir)).toEqual(EXPECTED_DECLARATIONS[api.api]);
    }

    expect(serializedApis(compiledReference())).toEqual(serializedApis(first));
  });
});
