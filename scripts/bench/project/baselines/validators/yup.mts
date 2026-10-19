// The baseline's request schemas written once with yup, with the contract's rules: unknown query and body keys
// refused, no coercion (strict mode), the same bounds and formats.
import * as yup from "yup";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TITLE_MAX = 200;
const LIST_LIMIT_MAX = 50;

type Part = "path" | "query" | "body";
const PARTS: readonly Part[] = ["path", "query", "body"];

const uuid = yup.string().required().matches(UUID);
const channelPath = yup.object({ channelId: uuid });
const taskPath = yup.object({ channelId: uuid, taskId: uuid });
const noQuery = yup.object({}).noUnknown();
const title = yup.string().min(1).max(TITLE_MAX);

const schemas: Readonly<Record<string, Partial<Record<Part, yup.Schema>>>> = {
  health: { query: noQuery },
  getChannel: { path: channelPath, query: noQuery },
  listTasks: {
    path: channelPath,
    query: yup
      .object({
        cursor: yup.string(),
        limit: yup.number().integer().min(1).max(LIST_LIMIT_MAX),
        sort: yup.array(yup.string().oneOf(["createdAt", "-createdAt"]).required()),
      })
      .noUnknown(),
  },
  createTask: {
    path: channelPath,
    query: noQuery,
    body: yup
      .object({ title: title.required(), effort: yup.number().integer().min(0) })
      .noUnknown(),
  },
  updateTask: {
    path: taskPath,
    query: noQuery,
    body: yup
      .object({
        title,
        state: yup.string().oneOf(["open", "done", "archived"]),
        effort: yup.number().integer().min(0),
        expectedVersion: yup.number().required().integer().min(1),
      })
      .noUnknown(),
  },
  payments: {
    query: noQuery,
    body: yup
      .object({
        id: yup.string().required(),
        type: yup.string().required(),
        data: yup.mixed().defined(),
      })
      .noUnknown(),
  },
};

/** The issues of a request's path, query and body against the route's schemas; none when it is valid. */
export async function validateRouteInput(
  routeId: string,
  parts: Readonly<Record<Part, unknown>>,
): Promise<readonly string[]> {
  const schema = Object.hasOwn(schemas, routeId) ? schemas[routeId] : undefined;

  if (schema === undefined) throw new Error(`bench: no yup schema for route '${routeId}'.`);

  const issues: string[] = [];

  for (const part of PARTS) {
    const partSchema = schema[part];

    if (partSchema !== undefined) issues.push(...(await partIssues(part, partSchema, parts[part])));
  }

  return issues;
}

async function partIssues(part: string, schema: yup.Schema, value: unknown): Promise<string[]> {
  try {
    await schema.validate(value, { strict: true, abortEarly: false });

    return [];
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;

    return error.errors.map((message) => `${part}: ${message}`);
  }
}
