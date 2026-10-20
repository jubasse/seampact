// The baseline's request schemas written once with VineJS, with the contract's rules: unknown query and body keys
// refused (VineJS drops them unless a rule reports them), no coercion (strict number and boolean), the same bounds and
// formats.
import { errors, Vine } from "@vinejs/vine";
import type { FieldContext, SchemaTypes } from "@vinejs/vine/types";
import { DATE_TIME, NAME_MAX, type RouteOutput } from "./response-facts.mjs";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TITLE_MAX = 200;
const LIST_LIMIT_MAX = 50;
const STATES = ["open", "done", "archived"];

type Part = "path" | "query" | "body";
const PARTS: readonly Part[] = ["path", "query", "body"];

const vine = new Vine();

const uuid = () => vine.string().regex(UUID);
const title = () => vine.string().minLength(1).maxLength(TITLE_MAX);

// VineJS's own types do not take an optional schema where a schema is expected once `exactOptionalPropertyTypes` is
// on, although it is one: this checks the members the compiler reads, and narrows to the schema type.
function isSchema(candidate: object): candidate is SchemaTypes {
  return (
    typeof Reflect.get(candidate, "clone") === "function" &&
    typeof Reflect.get(candidate, "toJSONSchema") === "function"
  );
}

function schemaOf(candidate: object): SchemaTypes {
  if (!isSchema(candidate)) throw new Error("bench: a VineJS schema lacks its schema members.");

  return candidate;
}

const optional = (schema: SchemaTypes & { optional(): object }) => schemaOf(schema.optional());
const effort = () => optional(vine.number({ strict: true }).withoutDecimals().min(0));

// An object that reports every key it does not declare, which VineJS otherwise drops silently, and every opaque member
// listed as required that is absent: VineJS reads an opaque `null` as missing, so the member is optional to it.
function strictObject(
  properties: Record<string, SchemaTypes>,
  requiredOpaque: readonly string[] = [],
) {
  const declared = Object.keys(properties);
  const noUnknownKeys = vine.createRule(
    (value: unknown, _options: undefined, field: FieldContext) => {
      if (typeof value !== "object" || value === null) return;

      for (const key of Object.keys(value)) {
        if (!declared.includes(key)) field.report(`unknown key ${key}`, "unknownKeys", field);
      }

      for (const key of requiredOpaque) {
        if (!Object.hasOwn(value, key)) field.report(`${key} is required`, "required", field);
      }
    },
    { implicit: true },
  );

  return vine.object(properties).allowUnknownProperties().bail(false).use(noUnknownKeys());
}

const channelPath = () => vine.object({ channelId: uuid() });
const taskPath = () => vine.object({ channelId: uuid(), taskId: uuid() });
const noQuery = () => strictObject({});

const requestSchemas: Readonly<Record<string, Partial<Record<Part, SchemaTypes>>>> = {
  health: { query: noQuery() },
  getChannel: { path: channelPath(), query: noQuery() },
  listTasks: {
    path: channelPath(),
    query: strictObject({
      cursor: optional(vine.string()),
      limit: optional(vine.number({ strict: true }).withoutDecimals().min(1).max(LIST_LIMIT_MAX)),
      sort: optional(vine.array(vine.enum(["createdAt", "-createdAt"]))),
    }),
  },
  createTask: {
    path: channelPath(),
    query: noQuery(),
    body: strictObject({ title: title(), effort: effort() }),
  },
  updateTask: {
    path: taskPath(),
    query: noQuery(),
    body: strictObject({
      title: optional(title()),
      state: optional(vine.enum(STATES)),
      effort: effort(),
      expectedVersion: vine.number({ strict: true }).withoutDecimals().min(1),
    }),
  },
  payments: {
    query: noQuery(),
    body: strictObject(
      { id: vine.string(), type: vine.string(), data: schemaOf(vine.any().optional()) },
      ["data"],
    ),
  },
};

const validators = new Map(
  Object.entries(requestSchemas).map(([routeId, parts]) => [
    routeId,
    PARTS.flatMap((part) => {
      const schema = parts[part];

      return schema === undefined ? [] : [{ part, validator: vine.create(schema) }];
    }),
  ]),
);

function messagesOf(part: string, error: errors.E_VALIDATION_ERROR): string[] {
  return error.messages.map((issue) => `${part}: ${issue.field} ${issue.message}`);
}

/** The issues of a request's path, query and body against the route's schemas; none when it is valid. */
export async function validateRouteInput(
  routeId: string,
  parts: Readonly<Record<Part, unknown>>,
): Promise<readonly string[]> {
  const routeValidators = validators.get(routeId);

  if (routeValidators === undefined)
    throw new Error(`bench: no VineJS schema for route '${routeId}'.`);

  const issues: string[] = [];

  for (const { part, validator } of routeValidators) {
    try {
      await validator.validate(parts[part]);
    } catch (error) {
      if (!(error instanceof errors.E_VALIDATION_ERROR)) throw error;

      issues.push(...messagesOf(part, error));
    }
  }

  return issues;
}

const task = () =>
  vine.object({
    taskId: uuid(),
    title: title(),
    state: vine.enum(STATES),
    effort: effort(),
    version: vine.number({ strict: true }).withoutDecimals().min(1),
    createdAt: vine.string().regex(DATE_TIME),
  });

// The success body of each route that answers one; VineJS drops the keys the contract does not declare, as the
// generated runtime's projection does.
const responseSchemas: Readonly<Record<string, SchemaTypes>> = {
  health: vine.object({ status: vine.string() }),
  getChannel: vine.object({
    channelId: uuid(),
    name: vine.string().minLength(1).maxLength(NAME_MAX),
  }),
  listTasks: vine.array(task()),
  createTask: task(),
  updateTask: task(),
};

const responseValidators = new Map(
  Object.entries(responseSchemas).map(([routeId, schema]) => [routeId, vine.create(schema)]),
);

/** The success body of a route checked against its response schema and cut to the declared shape. */
export async function validateRouteOutput(routeId: string, body: unknown): Promise<RouteOutput> {
  const validator = responseValidators.get(routeId);

  if (validator === undefined) {
    throw new Error(`bench: no VineJS response schema for route '${routeId}'.`);
  }

  try {
    return { issues: [], body: await validator.validate(body) };
  } catch (error) {
    if (!(error instanceof errors.E_VALIDATION_ERROR)) throw error;

    return { issues: messagesOf("body", error), body };
  }
}
