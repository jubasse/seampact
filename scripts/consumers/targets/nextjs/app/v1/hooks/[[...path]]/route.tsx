import { tasksRouteHandler } from "../../../../src/next-routes.mjs";

export const runtime = "nodejs";

export {
  tasksRouteHandler as DELETE,
  tasksRouteHandler as GET,
  tasksRouteHandler as HEAD,
  tasksRouteHandler as OPTIONS,
  tasksRouteHandler as PATCH,
  tasksRouteHandler as POST,
  tasksRouteHandler as PUT,
};
