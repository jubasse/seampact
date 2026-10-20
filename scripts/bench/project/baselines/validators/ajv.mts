// The baseline's request schemas written once with Ajv, with the contract's rules: unknown query and body keys
// refused, no coercion, the same bounds and formats.
import { Ajv2020, type ErrorObject, type SchemaObject } from "ajv/dist/2020.js";
import { DATE_TIME, NAME_MAX, type RouteOutput } from "./response-facts.mjs";

const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const TITLE_MAX = 200;
const LIST_LIMIT_MAX = 50;

type Part = "path" | "query" | "body";
const PARTS: readonly Part[] = ["path", "query", "body"];

const requestAjv = new Ajv2020({ allErrors: true, strict: true });

// A response is checked on a copy, from which Ajv removes every undeclared key: the declared shape the generated
// runtime's projection keeps.
const responseAjv = new Ajv2020({ allErrors: true, strict: true, removeAdditional: "all" });

const uuid: SchemaObject = { type: "string", pattern: UUID };
const channelPath: SchemaObject = {
  type: "object",
  properties: { channelId: uuid },
  required: ["channelId"],
};
const taskPath: SchemaObject = {
  type: "object",
  properties: { channelId: uuid, taskId: uuid },
  required: ["channelId", "taskId"],
};
const noQuery: SchemaObject = { type: "object", additionalProperties: false };
const title: SchemaObject = { type: "string", minLength: 1, maxLength: TITLE_MAX };

function strictObject(properties: Record<string, SchemaObject>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const requestSchemas: Readonly<Record<string, Partial<Record<Part, SchemaObject>>>> = {
  health: { query: noQuery },
  getChannel: { path: channelPath, query: noQuery },
  listTasks: {
    path: channelPath,
    query: strictObject({
      cursor: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: LIST_LIMIT_MAX },
      sort: { type: "array", items: { enum: ["createdAt", "-createdAt"] } },
    }),
  },
  createTask: {
    path: channelPath,
    query: noQuery,
    body: strictObject({ title, effort: { type: "integer", minimum: 0 } }, ["title"]),
  },
  updateTask: {
    path: taskPath,
    query: noQuery,
    body: strictObject(
      {
        title,
        state: { enum: ["open", "done", "archived"] },
        effort: { type: "integer", minimum: 0 },
        expectedVersion: { type: "integer", minimum: 1 },
      },
      ["expectedVersion"],
    ),
  },
  payments: {
    query: noQuery,
    body: strictObject({ id: { type: "string" }, type: { type: "string" }, data: {} }, [
      "id",
      "type",
      "data",
    ]),
  },
};

const validators = new Map(
  Object.entries(requestSchemas).map(([routeId, parts]) => [
    routeId,
    PARTS.flatMap((part) => {
      const schema = parts[part];

      return schema === undefined ? [] : [{ part, validate: requestAjv.compile(schema) }];
    }),
  ]),
);

const task: SchemaObject = {
  type: "object",
  properties: {
    taskId: uuid,
    title,
    state: { enum: ["open", "done", "archived"] },
    effort: { type: "integer", minimum: 0 },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "string", pattern: DATE_TIME.source },
  },
  required: ["taskId", "title", "state", "version", "createdAt"],
};

// The success body of each route that answers one.
const responseSchemas: Readonly<Record<string, SchemaObject>> = {
  health: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
  getChannel: {
    type: "object",
    properties: {
      channelId: uuid,
      name: { type: "string", minLength: 1, maxLength: NAME_MAX },
    },
    required: ["channelId", "name"],
  },
  listTasks: { type: "array", items: task },
  createTask: task,
  updateTask: task,
};

const responseValidators = new Map(
  Object.entries(responseSchemas).map(([routeId, schema]) => [
    routeId,
    responseAjv.compile(schema),
  ]),
);

function messagesOf(part: string, errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${part}: ${error.instancePath} ${error.message}`);
}

/** The issues of a request's path, query and body against the route's schemas; none when it is valid. */
export async function validateRouteInput(
  routeId: string,
  parts: Readonly<Record<Part, unknown>>,
): Promise<readonly string[]> {
  const routeValidators = validators.get(routeId);

  if (routeValidators === undefined)
    throw new Error(`bench: no Ajv schema for route '${routeId}'.`);

  return routeValidators.flatMap(({ part, validate }) => {
    return validate(parts[part]) ? [] : messagesOf(part, validate.errors);
  });
}

/** The success body of a route checked against its response schema and cut to the declared shape. */
export async function validateRouteOutput(routeId: string, body: unknown): Promise<RouteOutput> {
  const validate = responseValidators.get(routeId);

  if (validate === undefined) {
    throw new Error(`bench: no Ajv response schema for route '${routeId}'.`);
  }

  const copy = structuredClone(body);

  return validate(copy)
    ? { issues: [], body: copy }
    : { issues: messagesOf("body", validate.errors), body };
}
