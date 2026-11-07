// The hand-written Fastify server: the framework's router, a JSON content-type parser that keeps the raw bytes,
// the contract's routes as plain handlers, the logger off.
import Fastify from "fastify";
import { BASELINE_ROUTES, colonPath, runBaselineRoute } from "../route-work.mjs";

const HOST = "127.0.0.1";
const BODY_LIMIT_BYTES = 2_097_152;

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES });

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, bytes, done) => {
    Reflect.set(request, "rawBody", bytes);

    try {
      done(null, bytes.length === 0 ? undefined : JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)), undefined);
    }
  });

  for (const [routeId, route] of Object.entries(BASELINE_ROUTES)) {
    app[route.method](colonPath(route.path), async (request, reply) => {
      const answer = await runBaselineRoute(routeId, {
        path: Object.assign({}, request.params),
        query: Object.assign({}, request.query),
        headers: request.headers,
        body: request.body,
        rawBody: Reflect.get(request, "rawBody"),
        url: request.url,
      });

      reply.headers(answer.headers ?? {});

      return answer.body === undefined
        ? reply.code(answer.status).send()
        : reply.code(answer.status).send(answer.body);
    });
  }

  await app.listen({ port: 0, host: HOST });

  const address = app.server.address();

  if (address === null || typeof address === "string") {
    throw new Error(`The Fastify baseline listens on ${String(address)}, not on a TCP port.`);
  }

  return { baseUrl: `http://${HOST}:${address.port}`, close: () => app.close() };
}
