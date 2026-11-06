import { randomUUID } from "node:crypto";
import {
  type ContractIR,
  type DerivedFrom,
  type ErrorDecl,
  isKnownVariant,
  type Operation,
  type Response,
  type ResponseHeader,
  type TypeUse,
} from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { RawReply } from "./live-request.test-support.js";
import type { ReferenceIrChange } from "./reference-project.test-support.js";

// The booted response header tests of the Node server targets: the Deprecation, Sunset and successor Link headers
// of a deprecated route, and an `If-Match` version, whose absence answers 428 and whose item writes its ETag. The
// IR change gives the reference `tasks` api both forms: `getTask` deprecated in favour of `getChannel`, the tasks
// versioned by `If-Match` on `updateTask`, and a task title without a length limit, for a reply a server compresses.

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const TASK_PATH = `/v1/channels/${CHANNEL}/tasks/${TASK}`;

const DEPRECATED_OPERATION = "getTask";
const SUCCESSOR_OPERATION = "getChannel";
const VERSIONED_WRITE = "updateTask";
const VERSION_FIELD = "version";
const IF_MATCH = "If-Match";
const BODY_VERSION_PROPERTY = "expectedVersion";
const TITLE_PROPERTY = "title";
// Over the 1 KiB a compressing server (Fastify's own, `hono/compress`) starts at.
const COMPRESSED_TITLE = "x".repeat(2048);
const STALE_CODE = "state.conflict";
const PRECONDITION_FAILED_CODE = "api.precondition_failed";
const PRECONDITION_REQUIRED_CODE = "api.precondition_required";
const NOT_FOUND_CODE = "api.not_found";
const TASKS_CONCURRENCY = "/surfaces/app/routes/channels/member/routes/tasks/concurrency";
const LEGACY_DEPRECATED = "/surfaces/app/routes/channels/member/routes/tasks/ops/get/deprecated";
const STRING_USE: TypeUse = { kind: "scalar", type: "string", refinements: {} };
const CONCURRENCY_DERIVED: DerivedFrom = {
  derivation: "concurrency.version",
  from: [{ layer: "api", pointer: TASKS_CONCURRENCY }],
};
const DEPRECATION_DERIVED: DerivedFrom = {
  derivation: "deprecation.headers",
  from: [{ layer: "api", pointer: LEGACY_DEPRECATED }],
};

// `since` 2026-12-31 and `sunset` 2027-06-30, as RFC 9745 and RFC 8594 write them.
const DEPRECATION_VALUE = "@1798675200";
const SUNSET_VALUE = "Wed, 30 Jun 2027 00:00:00 GMT";
const SUCCESSOR_LINK = `</v1/channels/${CHANNEL}>; rel="successor-version"`;

const ENTITY_TAG_HEADER: ResponseHeader = {
  name: "ETag",
  type: STRING_USE,
  required: true,
  derivedFrom: CONCURRENCY_DERIVED,
};

function preconditionCode(base: ErrorDecl, code: string, role: string, status: number): ErrorDecl {
  return {
    ...base,
    code,
    default: role,
    http: { status },
    origin: { layer: "core", pointer: `/errors/${code}` },
  };
}

function withHeaders(response: Response, headers: Response["headers"]): Response {
  return { ...response, headers: [...response.headers, ...headers] };
}

function deprecatedRead(operation: Operation): Operation {
  return {
    ...operation,
    deprecated: {
      since: "2026-12-31",
      sunset: "2027-06-30",
      successor: { kind: "httpOperation", api: "tasks", id: SUCCESSOR_OPERATION },
      successorRel: "successor-version",
      origin: { layer: "api", pointer: LEGACY_DEPRECATED },
    },
    responses: operation.responses.map((response) =>
      withHeaders(response, [
        ENTITY_TAG_HEADER,
        {
          name: "Deprecation",
          type: STRING_USE,
          required: true,
          semantic: "deprecation",
          derivedFrom: DEPRECATION_DERIVED,
        },
        {
          name: "Sunset",
          type: STRING_USE,
          required: true,
          semantic: "sunset",
          derivedFrom: DEPRECATION_DERIVED,
        },
        {
          name: "Link",
          type: STRING_USE,
          required: true,
          semantic: "successorLink",
          derivedFrom: DEPRECATION_DERIVED,
        },
      ]),
    ),
  };
}

function ifMatchWrite(operation: Operation): Operation {
  const concurrency = operation.concurrency;

  if (concurrency === undefined)
    throw new Error(`the reference operation '${VERSIONED_WRITE}' lost its concurrency`);

  return {
    ...operation,
    concurrency: { ...concurrency, version: { in: "header", name: IF_MATCH } },
    params: {
      ...operation.params,
      header: [
        ...operation.params.header,
        { name: IF_MATCH, type: STRING_USE, required: true, derivedFrom: CONCURRENCY_DERIVED },
      ],
    },
    errors: operation.errors.flatMap((binding) =>
      binding.code === STALE_CODE
        ? [
            { ...binding, code: PRECONDITION_FAILED_CODE, roles: [{ role: "preconditionFailed" }] },
            {
              ...binding,
              code: PRECONDITION_REQUIRED_CODE,
              roles: [{ role: "preconditionRequired" }],
            },
          ]
        : [binding],
    ),
    responses: operation.responses.map((response) => withHeaders(response, [ENTITY_TAG_HEADER])),
  };
}

// A task item can outgrow the compression threshold through its title.
function withoutTitleLimit<Property extends { name: string; type: TypeUse }>(
  property: Property,
): Property {
  const type = property.type;

  if (
    property.name !== TITLE_PROPERTY ||
    !isKnownVariant("TypeUse", type) ||
    type.kind !== "scalar"
  )
    return property;

  const { maxLength: _limit, ...refinements } = type.refinements;

  return { ...property, type: { ...type, refinements } };
}

/**
 * Deprecates `getTask` in favour of `getChannel`, and moves the version of `updateTask` from its body to
 * `If-Match`, with the codes and headers the compiler derives for both.
 */
export const referenceResponseHeaders: ReferenceIrChange = (ir, api) => {
  if (api !== "tasks") return ir;

  const notFound = ir.errors[NOT_FOUND_CODE];
  const updateInput = ir.schemas.UpdateTask;
  const item = ir.schemas.Task;

  if (
    notFound === undefined ||
    updateInput === undefined ||
    !isKnownVariant("Schema", updateInput) ||
    updateInput.kind !== "object" ||
    item === undefined ||
    !isKnownVariant("Schema", item) ||
    item.kind !== "object"
  )
    throw new Error(
      "the reference tasks contract lost its api.not_found code, its UpdateTask or its Task schema",
    );

  const changed: ContractIR = {
    ...ir,
    errors: {
      ...ir.errors,
      [PRECONDITION_FAILED_CODE]: preconditionCode(
        notFound,
        PRECONDITION_FAILED_CODE,
        "preconditionFailed",
        412,
      ),
      [PRECONDITION_REQUIRED_CODE]: preconditionCode(
        notFound,
        PRECONDITION_REQUIRED_CODE,
        "preconditionRequired",
        428,
      ),
    },
    schemas: {
      ...ir.schemas,
      UpdateTask: {
        ...updateInput,
        properties: updateInput.properties.filter(
          (property) => property.name !== BODY_VERSION_PROPERTY,
        ),
      },
      Task: { ...item, properties: item.properties.map(withoutTitleLimit) },
    },
    operations: ir.operations.map((operation) => {
      if (operation.id === DEPRECATED_OPERATION) return deprecatedRead(operation);

      if (operation.id === VERSIONED_WRITE) return ifMatchWrite(operation);

      return operation;
    }),
  };

  return changed;
};

/** What the test app's handler answers receive, as the shared reference scenario calls them. */
export interface ResponseHeadersApp {
  readonly scenario: { answers: Record<string, (input: unknown, ...rest: never[]) => unknown> };
  readonly calls: { readonly handled: string[] };
}

/** A booted test app serving the reference api with `referenceResponseHeaders`, and a request to it. */
export interface ResponseHeadersBoot {
  readonly app: ResponseHeadersApp;
  send(
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: string },
  ): Promise<RawReply>;
}

function writeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...BEARER, "idempotency-key": randomUUID(), ...extra };
}

function sentIfMatch(input: unknown): unknown {
  const headers: unknown =
    typeof input === "object" && input !== null ? Reflect.get(input, "headers") : undefined;

  return typeof headers === "object" && headers !== null
    ? Reflect.get(headers, "if-match")
    : undefined;
}

function savedTask(version: number): Record<string, unknown> {
  return {
    taskId: TASK,
    title: "Saved",
    state: "open",
    [VERSION_FIELD]: version,
    createdAt: "2026-10-19T08:00:00Z",
  };
}

// The versions the write's handler receives in `If-Match`; it answers the saved task at version 2.
function recordSentVersions(app: ResponseHeadersApp): unknown[] {
  const sentVersions: unknown[] = [];

  app.scenario.answers[VERSIONED_WRITE] = (input) => {
    sentVersions.push(sentIfMatch(input));

    return { status: 200, body: savedTask(2) };
  };

  return sentVersions;
}

/** The response header tests of the reference api changed by `referenceResponseHeaders`. */
export function describeResponseHeaders(booted: () => ResponseHeadersBoot): void {
  test("a deprecated route answers its Deprecation, Sunset and successor Link headers", async () => {
    const { send } = booted();
    const reply = await send("GET", TASK_PATH, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(reply.headers).toMatchObject({
      deprecation: DEPRECATION_VALUE,
      sunset: SUNSET_VALUE,
      link: SUCCESSOR_LINK,
    });
  });

  test("an item read of a resource versioned by If-Match writes the ETag of its version field", async () => {
    const { send } = booted();
    const reply = await send("GET", TASK_PATH, { headers: BEARER });

    expect(reply.status).toBe(200);
    expect(reply.headers.etag).toBe('"1"');
  });

  test.each([
    ["without If-Match", {}],
    ["with an empty If-Match", { "if-match": "" }],
    ["with If-Match: *, which names no version", { "if-match": "*" }],
  ])("a write %s answers 428 with the preconditionRequired code", async (_, sent) => {
    const { app, send } = booted();
    const reply = await send("PATCH", TASK_PATH, {
      headers: writeHeaders(sent),
      body: '{"title":"Blind"}',
    });

    expect(reply.status).toBe(428);
    expect(JSON.parse(reply.text)).toMatchObject({ code: PRECONDITION_REQUIRED_CODE });
    expect(app.calls.handled).toEqual([]);
  });

  test("a write without If-Match answers 428 ahead of its invalid body", async () => {
    const { send } = booted();
    const reply = await send("PATCH", TASK_PATH, { headers: writeHeaders(), body: '{"title":5}' });

    expect(reply.status).toBe(428);
    expect(JSON.parse(reply.text)).toMatchObject({ code: PRECONDITION_REQUIRED_CODE });
  });

  test.each([
    ["a list of tags", '"1", "2"'],
    ["an unquoted version", "1"],
  ])(
    "a write whose If-Match is %s answers 412 with the preconditionFailed code",
    async (_, tag) => {
      const { app, send } = booted();
      const reply = await send("PATCH", TASK_PATH, {
        headers: writeHeaders({ "if-match": tag }),
        body: '{"title":"Listed"}',
      });

      expect(reply.status).toBe(412);
      expect(JSON.parse(reply.text)).toMatchObject({ code: PRECONDITION_FAILED_CODE });
      expect(app.calls.handled).toEqual([]);
    },
  );

  test.each([
    ["strong", '"1"'],
    ["weak", 'W/"1"'],
  ])(
    "a write with the current %s tag hands the handler its version and answers the new item's ETag",
    async (_, tag) => {
      const { app, send } = booted();
      const sentVersions = recordSentVersions(app);
      const reply = await send("PATCH", TASK_PATH, {
        headers: writeHeaders({ "if-match": tag }),
        body: '{"title":"Saved"}',
      });

      expect(reply.status).toBe(200);
      expect(reply.headers.etag).toBe('"2"');
      expect(sentVersions).toEqual(["1"]);
    },
  );

  test("an item whose version field is missing is an internal error, never a reply without its ETag", async () => {
    const { app, send } = booted();
    const { [VERSION_FIELD]: _dropped, ...unversioned } = savedTask(2);

    app.scenario.answers[VERSIONED_WRITE] = () => ({ status: 200, body: unversioned });

    const reply = await send("PATCH", TASK_PATH, {
      headers: writeHeaders({ "if-match": '"1"' }),
      body: '{"title":"Saved"}',
    });

    expect(reply.status).toBe(500);
    expect(reply.headers.etag).toBeUndefined();
  });
}

/**
 * On a server that compresses its replies: the ETag of a compressed item read comes back weak, and a write that
 * echoes it reaches the handler with the version it names.
 */
export function describeCompressedVersionTag(booted: () => ResponseHeadersBoot): void {
  test("a write echoing the weak ETag of a compressed item read reaches the handler", async () => {
    const { app, send } = booted();

    app.scenario.answers[DEPRECATED_OPERATION] = () => ({
      status: 200,
      body: { ...savedTask(1), title: COMPRESSED_TITLE },
    });

    const read = await send("GET", TASK_PATH, {
      headers: { ...BEARER, "accept-encoding": "gzip" },
    });

    expect(read.status).toBe(200);
    expect(read.headers["content-encoding"]).toBe("gzip");
    expect(read.headers.etag).toBe('W/"1"');

    const sentVersions = recordSentVersions(app);
    const write = await send("PATCH", TASK_PATH, {
      headers: writeHeaders({ "if-match": String(read.headers.etag) }),
      body: '{"title":"Saved"}',
    });

    expect(write.status).toBe(200);
    expect(sentVersions).toEqual(["1"]);
  });
}
