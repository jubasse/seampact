// The hand-written Express server: the framework's router and JSON parser, the contract's routes as plain
// handlers, Express's ETags off as in the generated app. Runs on the Express major the consumer installs.
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { BASELINE_ROUTES, colonPath, runBaselineRoute } from "../route-work.mjs";

const HOST = "127.0.0.1";
const BODY_LIMIT = "2mb";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const app = express();

  app.set("etag", false);
  app.use(
    express.json({
      strict: false,
      limit: BODY_LIMIT,
      verify: (request, _response, bytes) => Reflect.set(request, "rawBody", Buffer.from(bytes)),
    }),
  );

  for (const [routeId, route] of Object.entries(BASELINE_ROUTES)) {
    app[route.method](colonPath(route.path), async (request, response, next) => {
      try {
        const reply = await runBaselineRoute(routeId, {
          path: request.params,
          query: request.query,
          headers: request.headers,
          body: request.body,
          rawBody: Reflect.get(request, "rawBody"),
          url: request.originalUrl,
        });

        response.set(reply.headers ?? {});

        if (reply.body === undefined) response.status(reply.status).end();
        else response.status(reply.status).json(reply.body);
      } catch (error) {
        next(error);
      }
    });
  }

  const server = app.listen(0, HOST);

  await once(server, "listening");

  return {
    baseUrl: `http://${HOST}:${portOf(server.address())}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error(`The Express baseline listens on ${String(address)}, not on a TCP port.`);
  }

  return address.port;
}
