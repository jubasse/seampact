import { tasksServiceWritesHandler } from "../../../../src/next-routes.mjs";

export const runtime = "nodejs";

export {
  tasksServiceWritesHandler as DELETE,
  tasksServiceWritesHandler as GET,
  tasksServiceWritesHandler as HEAD,
  tasksServiceWritesHandler as OPTIONS,
  tasksServiceWritesHandler as PATCH,
  tasksServiceWritesHandler as POST,
  tasksServiceWritesHandler as PUT,
};
