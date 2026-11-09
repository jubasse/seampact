import { tasksServiceHandler } from "../../../../src/next-routes.mjs";

export const runtime = "nodejs";

export {
  tasksServiceHandler as DELETE,
  tasksServiceHandler as GET,
  tasksServiceHandler as HEAD,
  tasksServiceHandler as OPTIONS,
  tasksServiceHandler as PATCH,
  tasksServiceHandler as POST,
  tasksServiceHandler as PUT,
};
