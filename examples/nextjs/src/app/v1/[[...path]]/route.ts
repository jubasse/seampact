import { routeHandler } from "@/__generated__/server/notes";
import { notesRouteOptions } from "@/notes-route";

export const runtime = "nodejs";

const handler = routeHandler(notesRouteOptions);

export {
  handler as DELETE,
  handler as GET,
  handler as HEAD,
  handler as OPTIONS,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
