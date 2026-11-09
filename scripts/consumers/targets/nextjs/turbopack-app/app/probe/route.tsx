import * as TasksNext from "../../../generated/server/tasks";

export const runtime = "nodejs";

// Reading the module's exports loads the whole generated tree, which Turbopack must resolve to build the route.
export function GET(): Response {
  return Response.json(Object.keys(TasksNext).sort());
}
