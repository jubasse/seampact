// The hand-written Hono server on `@hono/node-server`: the framework's router, `cors` and `compress` as in the
// generated app's consumer, the contract's routes as plain handlers reading the body as text.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { BASELINE_ROUTES, colonPath, runBaselineRoute } from "../route-work.mjs";

const HOST = "127.0.0.1";
const BODY_METHODS: readonly string[] = ["post", "patch"];

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const app = new Hono();

  app.use(cors());
  app.use(compress());

  for (const [routeId, route] of Object.entries(BASELINE_ROUTES)) {
    app[route.method](colonPath(route.path), async (context) => {
      const text = BODY_METHODS.includes(route.method) ? await context.req.text() : "";
      const reply = await runBaselineRoute(routeId, {
        path: context.req.param(),
        query: context.req.query(),
        headers: Object.fromEntries(context.req.raw.headers),
        body: text === "" ? undefined : JSON.parse(text),
        rawBody: Buffer.from(text),
        url: `${new URL(context.req.url).pathname}${new URL(context.req.url).search}`,
      });

      for (const [name, value] of Object.entries(reply.headers ?? {})) context.header(name, value);

      return reply.body === undefined
        ? context.body(null, reply.status)
        : context.json(reply.body, reply.status);
    });
  }

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: HOST }, (info) =>
      resolve({
        baseUrl: `http://${HOST}:${info.port}`,
        close: () =>
          new Promise((done, failed) => {
            server.close((error) => (error ? failed(error) : done()));
          }),
      }),
    );
  });
}
