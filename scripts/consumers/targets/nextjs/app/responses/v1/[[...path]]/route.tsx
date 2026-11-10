import { tasksResponsesHandler } from "../../../../src/next-routes.mjs";

export const runtime = "nodejs";

export {
  tasksResponsesHandler as DELETE,
  tasksResponsesHandler as GET,
  tasksResponsesHandler as HEAD,
  tasksResponsesHandler as OPTIONS,
  tasksResponsesHandler as PATCH,
  tasksResponsesHandler as POST,
  tasksResponsesHandler as PUT,
};
