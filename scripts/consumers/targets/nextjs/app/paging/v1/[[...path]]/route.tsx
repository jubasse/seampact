import { tasksPagingHandler } from "../../../../src/next-routes.mjs";

export const runtime = "nodejs";

export {
  tasksPagingHandler as DELETE,
  tasksPagingHandler as GET,
  tasksPagingHandler as HEAD,
  tasksPagingHandler as OPTIONS,
  tasksPagingHandler as PATCH,
  tasksPagingHandler as POST,
  tasksPagingHandler as PUT,
};
