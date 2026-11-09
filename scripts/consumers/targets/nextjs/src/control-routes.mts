// The http suite's control routes as route handlers (the rewrite in `next.config.mts` maps `/__seampact/...` here),
// over the template's framework-neutral replies.
import {
  type ControlReply,
  hookCallsReply,
  loadScriptReply,
  logLinesReply,
} from "./suite-control.mjs";

function controlResponse(reply: ControlReply): Response {
  if (reply.body === undefined) return new Response(null, { status: reply.status });

  return Response.json(reply.body, { status: reply.status });
}

export async function putScript(request: Request): Promise<Response> {
  return controlResponse(loadScriptReply(await request.json()));
}

export function getHookCalls(): Response {
  return controlResponse(hookCallsReply());
}

export function getLogLines(): Response {
  return controlResponse(logLinesReply());
}
