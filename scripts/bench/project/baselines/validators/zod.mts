// The baseline's request schemas written once with zod, with the contract's rules: unknown query and body keys
// refused, no coercion, the same bounds and formats.
import { z } from "zod";
import { DATE_TIME, NAME_MAX, type RouteOutput } from "./response-facts.mjs";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TITLE_MAX = 200;
const LIST_LIMIT_MAX = 50;

type Part = "path" | "query" | "body";
const PARTS: readonly Part[] = ["path", "query", "body"];

const uuid = z.string().regex(UUID);
const channelPath = z.object({ channelId: uuid });
const taskPath = z.object({ channelId: uuid, taskId: uuid });
const noQuery = z.strictObject({});
const title = z.string().min(1).max(TITLE_MAX);

const schemas: Readonly<Record<string, Partial<Record<Part, z.ZodType>>>> = {
  health: { query: noQuery },
  getChannel: { path: channelPath, query: noQuery },
  listTasks: {
    path: channelPath,
    query: z.strictObject({
      cursor: z.string().optional(),
      limit: z.int().gte(1).lte(LIST_LIMIT_MAX).optional(),
      sort: z.array(z.enum(["createdAt", "-createdAt"])).optional(),
    }),
  },
  createTask: {
    path: channelPath,
    query: noQuery,
    body: z.strictObject({ title, effort: z.int().gte(0).optional() }),
  },
  updateTask: {
    path: taskPath,
    query: noQuery,
    body: z.strictObject({
      title: title.optional(),
      state: z.enum(["open", "done", "archived"]).optional(),
      effort: z.int().gte(0).optional(),
      expectedVersion: z.int().gte(1),
    }),
  },
  payments: {
    query: noQuery,
    body: z.strictObject({ id: z.string(), type: z.string(), data: z.unknown() }),
  },
};

const task = z.object({
  taskId: uuid,
  title,
  state: z.enum(["open", "done", "archived"]),
  effort: z.int().gte(0).optional(),
  version: z.int().gte(1),
  createdAt: z.string().regex(DATE_TIME),
});

// The success body of each route that answers one; a plain `z.object` drops the keys the contract does not
// declare, as the generated runtime's projection does.
const responseSchemas: Readonly<Record<string, z.ZodType>> = {
  health: z.object({ status: z.string() }),
  getChannel: z.object({ channelId: uuid, name: z.string().min(1).max(NAME_MAX) }),
  listTasks: z.array(task),
  createTask: task,
  updateTask: task,
};

/** The issues of a request's path, query and body against the route's schemas; none when it is valid. */
export async function validateRouteInput(
  routeId: string,
  parts: Readonly<Record<Part, unknown>>,
): Promise<readonly string[]> {
  const schema = Object.hasOwn(schemas, routeId) ? schemas[routeId] : undefined;

  if (schema === undefined) throw new Error(`bench: no zod schema for route '${routeId}'.`);

  return PARTS.flatMap((part) => {
    const partSchema = schema[part];

    if (partSchema === undefined) return [];

    const result = partSchema.safeParse(parts[part]);

    return result.success ? [] : result.error.issues.map((issue) => `${part}: ${issue.message}`);
  });
}

/** The success body of a route checked against its response schema and cut to the declared shape. */
export async function validateRouteOutput(routeId: string, body: unknown): Promise<RouteOutput> {
  const schema = Object.hasOwn(responseSchemas, routeId) ? responseSchemas[routeId] : undefined;

  if (schema === undefined)
    throw new Error(`bench: no zod response schema for route '${routeId}'.`);

  const result = schema.safeParse(body);

  return result.success
    ? { issues: [], body: result.data }
    : { issues: result.error.issues.map((issue) => `body: ${issue.message}`), body };
}
