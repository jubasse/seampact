import { describe, expect, it } from "vitest";
import { emitDocuments } from "./documents.js";
import { extensionMembers, goldenDocument, readGoldenIr } from "./golden-documents.test-support.js";
import { isJsonObject, type JsonObject, type JsonValue } from "./json-value.js";
import { nullableSchema } from "./schemas.js";

// What the golden documents state, read from the committed files the golden check keeps current: the mapped members
// of the reference contract (CHK-120), the public and full documents (CHK-010), sensitive fields (CHK-026) and the
// consumer extensions of the extensions case (CHK-050).

const FULL = goldenDocument("reference/openapi/tasks.full.yaml").document;
const PUBLIC = goldenDocument("reference/openapi/tasks.public.yaml").document;
const SERVICE = goldenDocument("reference/openapi/tasksService.yaml").document;
const NOTES = goldenDocument("bodies/openapi/notes.yaml").document;
const STUDIO = goldenDocument("extensions/openapi/studio.yaml").document;
const AGREEMENT = goldenDocument("agreement/openapi/agreement.yaml").document;
const HTTP_METHODS = ["get", "put", "post", "delete", "patch"];

function at(value: JsonValue | undefined, ...path: (string | number)[]): JsonValue | undefined {
  let current = value;

  for (const step of path) {
    if (Array.isArray(current) && typeof step === "number") current = current[step];
    else if (isJsonObject(current) && typeof step === "string") current = current[step];
    else return undefined;
  }

  return current;
}

function operations(document: JsonValue): Map<string, JsonObject> {
  const found = new Map<string, JsonObject>();
  const paths = at(document, "paths");

  if (!isJsonObject(paths)) return found;

  for (const pathItem of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = at(pathItem, method);

      if (isJsonObject(operation) && typeof operation.operationId === "string") {
        found.set(operation.operationId, operation);
      }
    }
  }

  return found;
}

function operation(document: JsonValue, id: string): JsonObject {
  const found = operations(document).get(id);

  if (found === undefined) throw new Error(`no operation ${id}`);

  return found;
}

function componentReferences(value: unknown): Set<string> {
  const references = new Set<string>();

  for (const text of JSON.stringify(value).matchAll(/"#\/components\/schemas\/([^"]+)"/g)) {
    if (text[1] !== undefined) references.add(text[1]);
  }

  return references;
}

describe("reference document states every mapped member", () => {
  it("writes access with its reason, and the cookie write with its CSRF header as one requirement", () => {
    expect(at(operation(FULL, "health"), "security")).toEqual([]);
    expect(at(operation(FULL, "health"), "x-seampact-access")).toEqual({
      public: expect.any(String),
    });
    expect(at(operation(FULL, "updateTask"), "security")).toEqual([
      { bearer: [] },
      { sessionCookie: [], csrfToken: [] },
    ]);
    expect(at(operation(FULL, "updateTask"), "x-seampact-access")).toEqual({ identity: "user" });
  });

  it("writes the signature scheme with its verification", () => {
    expect(at(FULL, "components", "securitySchemes", "stripeSignature")).toEqual({
      type: "apiKey",
      in: "header",
      name: "Stripe-Signature",
      "x-seampact-signature": {
        verify: "template",
        format: "t={ts},v1={sig}",
        algorithm: "hmac-sha256",
        payload: "{ts}.{rawBody}",
        encoding: "hex",
        toleranceMs: 300000,
        key: { value: "stripe" },
      },
    });
    expect(at(operation(FULL, "payments"), "security")).toEqual([{ stripeSignature: [] }]);
    expect(at(operation(FULL, "payments"), "requestBody", "x-seampact-raw-body")).toBe(true);
  });

  it("writes requirements, scopes and field rights", () => {
    expect(at(operation(FULL, "createTask"), "x-seampact-requires")).toEqual([
      { rule: "throttle", bucket: "write", entry: "writeThrottle" },
      {
        right: "roles",
        params: { allowed: ["owner", "editor"] },
        subject: "scope.channel",
        entry: "channelEditor",
      },
    ]);
    expect(at(operation(FULL, "updateTask"), "x-seampact-scopes")).toEqual([
      { scope: "channel", from: "path.channelId" },
    ]);
    expect(at(operation(FULL, "updateTask"), "x-seampact-restricted-to")).toEqual([
      { schema: "Task", pointer: "/effort", right: "tasks.seeEffort", direction: "output" },
      {
        schema: "UpdateTask",
        pointer: "/effort",
        right: "tasks.seeEffort",
        direction: "input",
        input: "reject",
      },
    ]);
  });

  it("writes paging with its sort-key rights", () => {
    expect(at(operation(FULL, "listTasks"), "x-seampact-paging")).toMatchObject({
      style: "cursor",
      maxLimit: 50,
      defaultLimit: 50,
      overLimit: "reject",
      sortKeys: [{ key: "createdAt" }],
    });
    expect(at(operation(NOTES, "listNotes"), "x-seampact-paging", "sortKeys")).toEqual([
      { key: "createdAt" },
      { key: "wordCount", right: "notes.seeWordCount", subject: "scope.space" },
    ]);
  });

  it("writes concurrency, idempotency and relays", () => {
    expect(at(operation(FULL, "updateTask"), "x-seampact-concurrency")).toEqual({
      version: "body.expectedVersion",
      field: "version",
    });
    expect(at(operation(FULL, "updateTask"), "x-seampact-idempotency")).toEqual({
      header: "Idempotency-Key",
      replayHeader: "Idempotency-Replayed",
      lifetimeMs: 86400000,
      required: true,
      enforce: "boundary",
    });
    expect(at(operation(SERVICE, "getTask"), "x-seampact-relays")).toEqual({
      api: "tasks",
      operationId: "getTask",
    });
  });

  it("writes each code of an error response with its derivation or origin", () => {
    const forbidden = at(operation(FULL, "updateTask"), "responses", "403");

    expect(at(forbidden, "description")).toBe("api.csrf_invalid, api.forbidden");
    expect(at(forbidden, "x-seampact-errors")).toEqual([
      { code: "api.csrf_invalid", derivedFrom: "csrf.cookieWrite" },
      { code: "api.forbidden", derivedFrom: "requirement.errors" },
    ]);

    expect(at(operation(STUDIO, "eventsStudio"), "responses", "503", "x-seampact-errors")).toEqual([
      {
        code: "studio.encoder_offline",
        derivedFrom: "node.errors",
        origin: "api#/surfaces/app/routes/studios/member/routes/events",
      },
    ]);
  });
});

describe("public and full documents", () => {
  it("leaves internal routes and the components only they use out of the public document", () => {
    const publicIds = [...operations(PUBLIC).keys()];

    expect(publicIds).not.toContain("archiveTask");
    expect(publicIds).not.toContain("payments");
    expect(JSON.stringify(PUBLIC)).not.toContain("x-seampact-internal");

    const components = Object.keys(at(PUBLIC, "components", "schemas") ?? {});

    expect(components.sort()).toEqual([...componentReferences(PUBLIC)].sort());
    expect(Object.keys(at(PUBLIC, "components", "securitySchemes") ?? {})).not.toContain(
      "stripeSignature",
    );
  });

  it("keeps internal routes in the full document, marked", () => {
    expect(at(operation(FULL, "archiveTask"), "x-seampact-internal")).toBe(true);
    expect([...operations(FULL).keys()]).toContain("payments");
  });

  it("writes one document for an api without documents", () => {
    const outcome = emitDocuments(readGoldenIr("bodies/notes"));

    expect(
      outcome.status === "emitted" ? outcome.documents.map((document) => document.name) : outcome,
    ).toEqual([undefined]);
  });
});

describe("sensitive fields are password", () => {
  it("writes a sensitive property and a body proof as format password", () => {
    expect(at(STUDIO, "components", "schemas", "Profile", "properties", "streamKey")).toEqual({
      type: "string",
      format: "password",
    });
    expect(
      at(
        operation(FULL, "purgeTask"),
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        "reauthToken",
        "format",
      ),
    ).toBe("password");
  });
});

describe("consumer extensions under their prefix", () => {
  const consumerKeys = (value: JsonValue | undefined) =>
    extensionMembers(value)
      .filter((member) => member.key.startsWith("x-acme-"))
      .map((member) => member.key);

  it("writes each key at the place it is declared", () => {
    const profile = operation(STUDIO, "profileStudio");
    const profileSchema = at(STUDIO, "components", "schemas", "Profile");

    expect(at(STUDIO, "x-acme-owner-team")).toBe("studio");
    expect(at(STUDIO, "x-acme-audience")).toEqual(["partners", "staff"]);
    expect(at(profile, "x-acme-invalidates")).toEqual(["profiles", "studios"]);
    expect(at(profile, "x-acme-cost")).toBe(3);
    expect(at(profileSchema, "x-acme-entity")).toBe("profile");
    expect(at(profileSchema, "properties", "displayName", "x-acme-searchable")).toBe(true);
    expect(at(profile, "x-seampact-requires", 0, "x-acme-right-group")).toBe("streams");
    expect(at(profile, "x-seampact-requires", 1, "x-acme-rule-window")).toBe(300);
    expect(at(profile, "x-seampact-scopes", 0, "x-acme-scope-kind")).toBe("tenant");
  });

  it("reaches about twenty keys over every place", () => {
    expect(new Set(consumerKeys(STUDIO)).size).toBeGreaterThanOrEqual(20);
  });
});

describe("nullable values are spelled as ADR 0003 states", () => {
  const agreementSchema = (...path: string[]) => at(AGREEMENT, "components", "schemas", ...path);

  it("writes a type array for a typed value and leaves an opaque value as it is", () => {
    expect(agreementSchema("Receipt", "properties", "note")).toEqual({ type: ["string", "null"] });
    expect(agreementSchema("PatchArticle", "properties", "publishOn")).toEqual({
      type: ["string", "null"],
      format: "date",
    });
    expect(agreementSchema("OptionalEnvelope", "properties", "data")).toEqual({
      "x-seampact-opaque": expect.any(String),
    });
  });

  it("writes oneOf with null around a reference, and adds null to a closed enum", () => {
    expect(nullableSchema({ $ref: "#/components/schemas/Role" })).toEqual({
      oneOf: [{ $ref: "#/components/schemas/Role" }, { type: "null" }],
    });
    expect(nullableSchema({ type: "string", enum: ["owner"] })).toEqual({
      type: ["string", "null"],
      enum: ["owner", null],
    });
  });
});
