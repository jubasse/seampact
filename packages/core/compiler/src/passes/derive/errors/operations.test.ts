import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR, DraftOperation } from "../../../pipeline/seam.js";
import {
  type DeriveErrorsRun,
  deriveErrorsLoadFiles,
  deriveErrorsLoadFixture,
  deriveErrorsLocated,
  deriveErrorsReferenceWorkspace,
  deriveErrorsRunContract,
  deriveErrorsRunReference,
} from "./test-support.js";

const TASKS = "/surfaces/app/routes/tasks";

function operationOf(draft: DraftIR, id: string): DraftOperation {
  const operation = draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the draft has no operation ${id}`);

  return operation;
}

const codesOf = (draft: DraftIR, id: string): string[] =>
  (operationOf(draft, id).errors ?? []).map((error) => error.code);

function errorOf(draft: DraftIR, id: string, code: string): IrWriter.OperationError {
  const error = operationOf(draft, id).errors?.find((candidate) => candidate.code === code);

  if (error === undefined) throw new Error(`operation ${id} has no error ${code}`);

  return error;
}

const derivationOf = (draft: DraftIR, id: string, code: string): string | undefined =>
  errorOf(draft, id, code).derivedFrom?.derivation;

// A collection that declares no `ops`: the only route below its member scope is the nested collection's.
const OPLESS_COLLECTION = `api: { name: shop, version: 1 }
errors:
  tasks.not_found: { status: 404 }
schemas:
  TaskId: { type: string }
  CommentId: { type: string }
  Task: { type: object, required: [taskId], properties: { taskId: TaskId } }
  Comment: { type: object, required: [commentId], properties: { commentId: CommentId } }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks member.notFound only. }
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        member:
          errorRoles:
            notFound: tasks.not_found
          routes:
            comments:
              kind: collection
              id: { commentId: CommentId }
              item: Comment
              ops: { list: { paging: none } }
`;

const operationsRun = (): DeriveErrorsRun =>
  deriveErrorsRunContract(deriveErrorsLoadFixture("operations"));

describe("attached codes reach", () => {
  test("the grammar 11 tasks.locked attachment reaches updateTask and assignTask only", () => {
    const { draft } = operationsRun();
    const reached = draft.operations
      .filter((operation) => operation.errors?.some((error) => error.code === "tasks.locked"))
      .map((operation) => operation.id);

    expect(reached).toEqual(["updateTask", "assignTask"]);
    expect(errorOf(draft, "assignTask", "tasks.locked")).toMatchObject({
      origin: { layer: "api", pointer: `${TASKS}/member` },
      derivedFrom: { derivation: "node.errors" },
    });
  });

  test("the nearest attachment keeps its origin and narrowed example", () => {
    const { draft } = operationsRun();

    expect(errorOf(draft, "listTasks", "api.rate_limited")).toMatchObject({
      example: { retryAfterMs: 30000 },
      origin: { pointer: TASKS },
    });
    expect(errorOf(draft, "getTask", "api.rate_limited")).toMatchObject({
      example: { retryAfterMs: 1000 },
      origin: { pointer: `${TASKS}/member` },
    });
  });

  test("conventions.errors.every attaches its codes to every operation", () => {
    const { draft } = operationsRun();

    for (const operation of draft.operations)
      expect(errorOf(draft, operation.id ?? "", "shop.maintenance").derivedFrom).toEqual({
        derivation: "conventions.every",
        from: [{ layer: "api", pointer: "/conventions/errors/every/0" }],
      });
  });

  test("errors are sorted by status, then code", () => {
    expect(codesOf(operationsRun().draft, "getTask")).toEqual([
      "api.schema_invalid",
      "tasks.not_found",
      "state.conflict",
      "api.rate_limited",
      "api.internal",
      "shop.maintenance",
    ]);
  });
});

describe("derived codes", () => {
  test("a role answers its nearest binding's code, with the role and the binding's origin last in from", () => {
    const error = errorOf(operationsRun().draft, "getTask", "tasks.not_found");

    expect(error.roles).toEqual([{ role: "notFound" }]);
    expect(error.derivedFrom?.derivation).toBe("member.notFound");
    expect(error.derivedFrom?.from.at(-1)).toEqual({
      layer: "api",
      pointer: `${TASKS}/member/errorRoles/notFound`,
    });
  });

  test("a bucket rule without codes answers rateLimited with the retry header and the by-name params", () => {
    const error = errorOf(operationsRun().draft, "updateTask", "api.rate_limited");

    expect(error.roles).toEqual([
      {
        role: "rateLimited",
        params: {
          kind: "object",
          members: [
            {
              name: { kind: "text", text: "retryAfterMs" },
              value: { kind: "slot", slot: "retryAfterMs", path: [] },
            },
          ],
        },
      },
    ]);
    expect(error.retryHeader).toEqual({
      name: "Retry-After",
      param: "retryAfterMs",
      unit: "s",
      derivedFrom: {
        derivation: "rule.bucket",
        from: [{ layer: "api", pointer: `${TASKS}/ops/update/requires/0` }],
      },
    });
  });

  test("a body answers payloadTooLarge and unsupportedMediaType, every operation undeclaredStatus", () => {
    const { draft } = operationsRun();

    expect(derivationOf(draft, "assignTask", "api.payload_too_large")).toBe("body.limit");
    expect(derivationOf(draft, "assignTask", "api.unsupported_media_type")).toBe("body.media");
    expect(derivationOf(draft, "listTasks", "api.internal")).toBe("response.undeclared");
    expect(codesOf(draft, "listTasks")).not.toContain("api.payload_too_large");
  });

  test("the reference contract derives csrf, identity, field right and bucket codes", () => {
    const { draft, diagnostics } = deriveErrorsRunReference(
      deriveErrorsReferenceWorkspace(),
      "tasks",
    );

    expect(diagnostics).toEqual([]);
    expect(derivationOf(draft, "createTask", "api.csrf_invalid")).toBe("csrf.cookieWrite");
    expect(derivationOf(draft, "listChannels", "api.unauthenticated")).toBe(
      "identity.authenticate",
    );
    expect(derivationOf(draft, "listChannels", "api.schema_invalid")).toBe("paging.params");
    expect(
      errorOf(draft, "createTask", "api.rate_limited").retryHeader?.derivedFrom.derivation,
    ).toBe("rule.bucket");
    expect(derivationOf(draft, "purgeTask", "api.reauthentication_required")).toBe(
      "requirement.errors",
    );
  });
});

describe("gateway and service codes", () => {
  test("a service api answers deadlineExceeded on every operation from api.service", () => {
    const { draft } = deriveErrorsRunReference(deriveErrorsReferenceWorkspace(), "tasksService");

    expect(errorOf(draft, "getTask", "api.deadline_exceeded")).toMatchObject({
      roles: [{ role: "deadlineExceeded" }],
      derivedFrom: { derivation: "api.service" },
    });
  });

  test("derive.wire's idempotency key and version parameter answer their roles", () => {
    const { draft } = deriveErrorsRunContract(deriveErrorsReferenceWorkspace());

    expect(derivationOf(draft, "createTask", "api.idempotency_in_progress")).toBe(
      "idempotency.write",
    );
    expect(derivationOf(draft, "createTask", "api.idempotency_key_reused")).toBe(
      "idempotency.write",
    );
    expect(errorOf(draft, "updateTask", "state.conflict")).toMatchObject({
      roles: [{ role: "stateConflict" }],
      derivedFrom: { derivation: "concurrency.version" },
    });
  });
});

describe("not found", () => {
  test("member.notFound is absent where a scope reads the id and present below a member scope otherwise", () => {
    const { draft } = deriveErrorsRunReference(deriveErrorsReferenceWorkspace(), "tasks");

    expect(derivationOf(draft, "getChannel", "api.not_found")).toBe("scope.errors");
    expect(derivationOf(draft, "getTask", "api.not_found")).toBe("member.notFound");
    expect(codesOf(draft, "listChannels")).not.toContain("api.not_found");
  });

  test("a nested collection's routes answer notFound for the parent's member id too", () => {
    expect(derivationOf(operationsRun().draft, "listComments", "tasks.not_found")).toBe(
      "member.notFound",
    );
  });
});

describe("not found without operations on the collection", () => {
  test("a collection with no ops still gives its member id to the routes below it", () => {
    const { diagnostics, draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": OPLESS_COLLECTION }),
    );

    expect(diagnostics).toEqual([]);
    expect(derivationOf(draft, "listComments", "tasks.not_found")).toBe("member.notFound");
  });
});

describe("owner caller", () => {
  test("a route of an owner: caller resource answers notFound from owner.caller", () => {
    const { draft } = deriveErrorsRunReference(deriveErrorsReferenceWorkspace(), "tasks");

    expect(derivationOf(draft, "getPreferences", "api.not_found")).toBe("owner.caller");
  });
});

describe("forbidden pointer", () => {
  test("a binding without the pointer param is refused on an operation with a rejected restricted input field", () => {
    const run = deriveErrorsRunContract(deriveErrorsLoadFixture("forbidden-pointer"));

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/conventions/errors/derived/forbidden",
        related: ["/surfaces/app/routes/notes/ops/create"],
      },
    ]);
    expect(errorOf(run.draft, "createNote", "notes.denied")).toMatchObject({
      roles: [{ role: "forbidden" }],
      derivedFrom: { derivation: "fieldRight.restricted" },
    });
    expect(codesOf(run.draft, "listNotes")).not.toContain("notes.denied");
  });
});

describe("error examples", () => {
  test("an unknown code and a params value that does not fit are refused, located inside the value", () => {
    const assign = `${TASKS}/member/routes/assign/examples`;

    expect(operationsRun().diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-example",
        pointer: `${assign}/locked/value/lockedBy`,
        related: [],
      },
      { rule: "seampact/derive/error-unknown", pointer: `${assign}/missing/error`, related: [] },
    ]);
  });
});

describe("every derived error carries derivedFrom", () => {
  test("a walk over every operation's errors finds none without derivedFrom", () => {
    const drafts = [
      operationsRun().draft,
      deriveErrorsRunReference(deriveErrorsReferenceWorkspace(), "tasks").draft,
      deriveErrorsRunReference(deriveErrorsReferenceWorkspace(), "tasksService").draft,
    ];
    const missing = drafts.flatMap((draft) =>
      draft.operations.flatMap((operation) =>
        (operation.errors ?? [])
          .filter((error) => error.derivedFrom === undefined)
          .map((error) => `${operation.id} ${error.code}`),
      ),
    );

    expect(
      drafts.every((draft) => draft.operations.every((op) => (op.errors ?? []).length > 0)),
    ).toBe(true);
    expect(missing).toEqual([]);
  });
});
