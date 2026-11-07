import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEFAULT_EMITTER_OPTIONS, type EmitterOptions } from "../emitter-options.js";
import { EXTENSION_PREFIX, isExtensionName } from "../extension-names.js";
import {
  createExtensionValidators,
  createOasValidator,
  extensionMembers,
  readGoldenIr,
} from "../golden-documents.test-support.js";
import { isJsonObject, type JsonObject, type JsonValue } from "../json-value.js";
import { type MergeInput, type MergeOutcome, mergeDocuments } from "./merge-documents.js";

// CHK-171: the merged document of a monorepo root, from the golden IRs of the reference workspace.

const TASKS = readGoldenIr("reference/tasks");
const TASKS_SERVICE = readGoldenIr("reference/tasksService");
const NOTES = readGoldenIr("bodies/notes");
const LEDGER = readGoldenIr("every-default/ledger");
const STUDIO = readGoldenIr("extensions/studio");
const SERVICE_PREFIX = { tasksService: "svc" };
const SCHEMA_REFERENCE_START = "#/components/schemas/";

function merge(
  inputs: readonly MergeInput[],
  prefix: Record<string, string> = {},
  emitter: EmitterOptions = DEFAULT_EMITTER_OPTIONS,
): MergeOutcome {
  return mergeDocuments(inputs, { name: "platform", prefix, emitter });
}

function mergedObject(outcome: MergeOutcome): JsonObject {
  if (outcome.status !== "merged") {
    throw new Error(`refused: ${outcome.refusals.map((refusal) => refusal.message).join("; ")}`);
  }

  const document: unknown = parse(outcome.text);

  if (!isJsonObject(document)) throw new Error("a merged document is a mapping");

  return document;
}

function refusalCodes(outcome: MergeOutcome): string[] {
  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

function member(object: JsonValue | undefined, name: string): JsonObject {
  if (!isJsonObject(object)) return {};

  const value = object[name];

  return isJsonObject(value) ? value : {};
}

function operationsOf(document: JsonObject): JsonObject[] {
  return Object.values(member(document, "paths")).flatMap((pathItem) =>
    isJsonObject(pathItem) ? Object.values(pathItem).filter(isJsonObject) : [],
  );
}

function schemaReferences(value: JsonValue): string[] {
  if (typeof value === "string") return value.startsWith(SCHEMA_REFERENCE_START) ? [value] : [];

  if (Array.isArray(value)) return value.flatMap(schemaReferences);

  return isJsonObject(value) ? Object.values(value).flatMap(schemaReferences) : [];
}

function requirementSchemes(operation: JsonObject): string[] {
  const requirements = Array.isArray(operation.security) ? operation.security : [];

  return requirements.flatMap((requirement) =>
    isJsonObject(requirement) ? Object.keys(requirement) : [],
  );
}

function renamedApi(ir: ContractIR, id: string): ContractIR {
  return { ...structuredClone(ir), api: { ...structuredClone(ir.api), id } };
}

function narrowed(ir: ContractIR, operationIds: readonly string[]): ContractIR {
  const copy = structuredClone(ir);

  copy.operations = copy.operations.filter((operation) => operationIds.includes(operation.id));

  return copy;
}

// The api's single operation answering `method` at `path`, its path parameter `from` renamed `to`.
function movedOperation(ir: ContractIR, method: string, from: string, to: string): ContractIR {
  const copy = structuredClone(ir);

  for (const operation of copy.operations) {
    operation.method = method;
    operation.path = operation.path.replace(`{${from}}`, `{${to}}`);

    for (const parameter of operation.params.path) {
      if (parameter.name === from) parameter.name = to;
    }
  }

  return copy;
}

function objectsHolding(value: JsonValue, name: string): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => objectsHolding(item, name));

  if (!isJsonObject(value)) return [];

  const nested = Object.values(value).flatMap((item) => objectsHolding(item, name));

  return value[name] === undefined ? nested : [value, ...nested];
}

describe("merged document", () => {
  it("writes an element two inputs give identically once", () => {
    const alone = mergedObject(merge([{ ir: TASKS }]));
    const twice = mergedObject(merge([{ ir: TASKS }, { ir: structuredClone(TASKS) }]));
    const withNotes = mergedObject(merge([{ ir: TASKS }, { ir: NOTES }]));
    const tasksSchemas = Object.keys(member(member(alone, "components"), "schemas"));
    const notesSchemas = Object.keys(
      member(member(mergedObject(merge([{ ir: NOTES }])), "components"), "schemas"),
    );
    const sharedSchemas = tasksSchemas.filter((key) => notesSchemas.includes(key));

    expect(twice).toEqual(alone);
    expect(sharedSchemas.length).toBeGreaterThan(0);
    expect(Object.keys(member(member(withNotes, "components"), "schemas")).sort()).toEqual(
      [...new Set([...tasksSchemas, ...notesSchemas])].sort(),
    );
  });

  it("refuses two different elements under one name, naming both apis and the prefix fix", () => {
    const outcome = merge([{ ir: TASKS }, { ir: TASKS_SERVICE }]);

    expect(outcome.status).toBe("refused");

    if (outcome.status !== "refused") return;

    const clash = outcome.refusals.find((refusal) =>
      refusal.message.includes("the operation 'getTask'"),
    );

    expect(clash?.code).toBe("openapi.merge.name-clash");
    expect(clash?.message).toContain("of the api 'tasks'");
    expect(clash?.message).toContain("of the api 'tasksService'");
    expect(clash?.fix).toContain("Set a prefix for 'tasks' or 'tasksService'");
  });

  it("applies a prefix to operation ids, component keys and every reference to them", () => {
    const document = mergedObject(merge([{ ir: TASKS }, { ir: TASKS_SERVICE }], SERVICE_PREFIX));
    const components = member(document, "components");
    const schemaKeys = Object.keys(member(components, "schemas"));
    const schemeKeys = Object.keys(member(components, "securitySchemes"));
    const serviceOperations = operationsOf(document).filter(
      (operation) => operation[`${EXTENSION_PREFIX}source-api`] === "tasksService",
    );

    expect(serviceOperations.length).toBeGreaterThan(0);

    for (const operation of serviceOperations) {
      expect(String(operation.operationId)).toMatch(/^svc\./);

      for (const scheme of requirementSchemes(operation)) expect(scheme).toMatch(/^svc\./);
    }

    expect(schemaKeys.some((key) => key.startsWith("svc."))).toBe(true);
    expect(schemeKeys.some((key) => key.startsWith("svc."))).toBe(true);

    for (const reference of schemaReferences(document)) {
      expect(schemaKeys).toContain(reference.slice(SCHEMA_REFERENCE_START.length));
    }

    for (const operation of operationsOf(document)) {
      for (const scheme of requirementSchemes(operation)) expect(schemeKeys).toContain(scheme);
    }

    expect(createOasValidator()(document)).toEqual([]);
  });

  it("always refuses two apis answering the same method and path", () => {
    const copy = renamedApi(TASKS, "tasksCopy");
    const outcome = merge([{ ir: TASKS }, { ir: copy }], { tasksCopy: "copy" });
    const routeClash = outcome.status === "refused" ? outcome.refusals[0] : undefined;

    expect([...new Set(refusalCodes(outcome))]).toEqual(["openapi.merge.route-clash"]);
    expect(routeClash?.message).toContain("of the api 'tasks'");
    expect(routeClash?.message).toContain("of the api 'tasksCopy'");
    expect(routeClash?.fix).toContain("distinct contract path");
  });

  it("lists the apis at the root and the source api on each operation", () => {
    const document = mergedObject(merge([{ ir: TASKS }, { ir: TASKS_SERVICE }], SERVICE_PREFIX));
    const validators = createExtensionValidators();

    expect(document[`${EXTENSION_PREFIX}api`]).toBeUndefined();
    expect(document[`${EXTENSION_PREFIX}apis`]).toEqual([
      { name: "tasks", kind: "product", version: "1", summary: "Tasks shared inside channels." },
      {
        name: "tasksService",
        kind: "service",
        caller: { identity: "service", right: "callerService" },
        version: "1",
      },
    ]);

    for (const operation of operationsOf(document)) {
      expect(["tasks", "tasksService"]).toContain(operation[`${EXTENSION_PREFIX}source-api`]);
    }

    for (const { key, value } of extensionMembers(document)) {
      const name = key.slice(EXTENSION_PREFIX.length);

      if (!key.startsWith(EXTENSION_PREFIX) || !isExtensionName(name)) continue;

      expect(validators.get(name)?.(value)).toEqual([]);
    }
  });

  it("applies the emitter options to the merged document", () => {
    const document = mergedObject(
      merge(
        [{ ir: TASKS }, { ir: NOTES }],
        {},
        {
          ...DEFAULT_EMITTER_OPTIONS,
          extensions: "none",
          servers: [{ url: "https://api.example.com" }],
        },
      ),
    );

    expect(document.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(
      extensionMembers(document).filter(({ key }) => key.startsWith(EXTENSION_PREFIX)),
    ).toEqual([]);
  });

  it("writes the same bytes whatever the order of its inputs", () => {
    const forward = merge([{ ir: TASKS }, { ir: TASKS_SERVICE }], SERVICE_PREFIX);
    const backward = merge([{ ir: TASKS_SERVICE }, { ir: TASKS }], SERVICE_PREFIX);

    expect(forward.status).toBe("merged");
    expect(backward).toEqual(forward);
  });

  it("refuses an api two apps give in different versions", () => {
    const changed = structuredClone(TASKS);

    changed.api.kind = "service";

    expect(refusalCodes(merge([{ ir: TASKS }, { ir: changed }]))).toContain(
      "openapi.merge.api-versions",
    );
  });

  it("refuses an input or a prefix it cannot use, by name", () => {
    expect(refusalCodes(merge([]))).toEqual(["openapi.merge.empty"]);
    expect(refusalCodes(merge([{ ir: TASKS }], { billing: "bill" }))).toEqual([
      "openapi.merge.prefix-api",
    ]);
    expect(refusalCodes(merge([{ ir: TASKS }], { tasks: "a/b" }))).toEqual([
      "openapi.merge.prefix-invalid",
    ]);
    expect(refusalCodes(merge([{ ir: TASKS, document: "missing" }]))).toEqual([
      "openapi.merge.unknown-document",
    ]);
  });

  it("takes a declared document's surfaces", () => {
    const declared = Object.keys(TASKS.api.documents);

    expect(declared).toContain("public");

    const publicOnly = mergedObject(merge([{ ir: TASKS, document: "public" }]));

    expect(
      operationsOf(publicOnly).filter(
        (operation) => operation[`${EXTENSION_PREFIX}internal`] !== undefined,
      ),
    ).toEqual([]);
  });

  it("refuses two apis answering one route under different parameter names", () => {
    const draft = narrowed(TASKS, ["getDraft"]);
    const sameMethod = renamedApi(movedOperation(draft, "get", "draftId", "id"), "drafts");
    const otherMethod = renamedApi(movedOperation(draft, "put", "draftId", "id"), "drafts");

    for (const other of [sameMethod, otherMethod]) {
      const outcome = merge([{ ir: draft }, { ir: other }], { drafts: "d" });

      expect([...new Set(refusalCodes(outcome))]).toEqual(["openapi.merge.route-clash"]);
    }
  });

  it("refuses one api in two versions, whatever the order of its inputs", () => {
    const later = structuredClone(TASKS);

    later.api.version = { kind: "path", number: 9 };

    const forward = merge([{ ir: TASKS }, { ir: later }]);
    const backward = merge([{ ir: later }, { ir: TASKS }]);

    expect(refusalCodes(forward)).toContain("openapi.merge.api-versions");
    expect(backward.status).toBe("refused");
  });

  it("carries each api's version, docs and root consumer extensions in its apis item", () => {
    const document = mergedObject(merge([{ ir: TASKS }, { ir: STUDIO }], { studio: "s" }));
    const items = Array.isArray(document[`${EXTENSION_PREFIX}apis`])
      ? document[`${EXTENSION_PREFIX}apis`]
      : [];

    expect(document["x-acme-owner-team"]).toBeUndefined();
    expect(items).toEqual([
      expect.objectContaining({ name: "studio", version: "1", "x-acme-owner-team": "studio" }),
      expect.objectContaining({
        name: "tasks",
        version: "1",
        summary: "Tasks shared inside channels.",
      }),
    ]);
    expect(document.info).toEqual({ title: "platform", version: "studio 1, tasks 1" });
  });

  it("writes the union of two narrowed contributions of one api", () => {
    const whole = mergedObject(merge([{ ir: narrowed(TASKS, ["getTask", "listTasks"]) }]));
    const union = mergedObject(
      merge([{ ir: narrowed(TASKS, ["getTask"]) }, { ir: narrowed(TASKS, ["listTasks"]) }]),
    );

    expect(union).toEqual(whole);
  });

  it("states the most-used format at the root, a tie going to the first id", () => {
    const tie = mergedObject(
      merge(
        [
          { ir: narrowed(NOTES, [NOTES.operations[0]?.id ?? ""]) },
          { ir: narrowed(LEDGER, [LEDGER.operations[0]?.id ?? ""]) },
        ],
        {
          ledger: "l",
        },
      ),
    );
    const formats = operationsOf(tie).map((operation) => operation[`${EXTENSION_PREFIX}format`]);

    expect(tie[`${EXTENSION_PREFIX}format`]).toBe("bare");
    expect(formats.sort()).toEqual(["house", undefined].sort());
    expect(
      mergedObject(merge([{ ir: NOTES }, { ir: LEDGER }], { ledger: "l" }))[
        `${EXTENSION_PREFIX}format`
      ],
    ).toBe("house");
  });

  it("maps each error code of a prefixed api to its prefixed component", () => {
    const document = mergedObject(merge([{ ir: TASKS }], { tasks: "p" }));
    const schemaKeys = Object.keys(member(member(document, "components"), "schemas"));
    const forbidden = member(
      member(
        member(
          member(member(member(document, "paths"), "/v1/channels/{channelId}/tasks"), "post"),
          "responses",
        ),
        "403",
      ),
      "content",
    );
    const discriminators = objectsHolding(document, "discriminator");

    expect(JSON.stringify(forbidden)).toContain(
      '"api.forbidden":"#/components/schemas/p.api.forbidden"',
    );
    expect(discriminators.length).toBeGreaterThan(0);

    for (const schema of discriminators) {
      const mapping = member(schema.discriminator, "mapping");
      const references = (Array.isArray(schema.oneOf) ? schema.oneOf : []).flatMap((branch) =>
        isJsonObject(branch) && typeof branch.$ref === "string" ? [branch.$ref] : [],
      );

      for (const reference of references) expect(Object.values(mapping)).toContain(reference);

      for (const reference of Object.values(mapping)) {
        expect(schemaKeys).toContain(String(reference).slice(SCHEMA_REFERENCE_START.length));
      }
    }
  });

  it("names a prefixed schema in each field right", () => {
    const document = mergedObject(
      merge([{ ir: TASKS }, { ir: NOTES }], { tasks: "p", notes: "n" }),
    );
    const schemaKeys = Object.keys(member(member(document, "components"), "schemas"));
    const restrictedSchemas = objectsHolding(document, `${EXTENSION_PREFIX}restricted-to`).flatMap(
      (holder) => {
        const items = holder[`${EXTENSION_PREFIX}restricted-to`];

        return Array.isArray(items) ? items.map((item) => member({ item }, "item").schema) : [];
      },
    );

    expect(restrictedSchemas.length).toBeGreaterThan(0);

    for (const schema of restrictedSchemas) expect(schemaKeys).toContain(schema);
  });
});
