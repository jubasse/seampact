// A Fastify app around the generated plugins of the apis it is given, for the native docs test: `@fastify/swagger` in
// dynamic mode with `contractSwaggerTransformObject` of each api, then the plugins with the shared scenario's handler
// map and hooks. Nothing is served; copied next to the compiled generated tree, so it imports the generated modules
// by relative path.
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { handlers, hooks, resetScenario } from "./reference-scenario.js";

// The `tasksService` api's one operation, and the service identity it authenticates.
const SERVICE_HANDLERS = { InternalEndpoints: { getTask: () => ({}) } };
const SERVICE_HOOKS = {
  ...hooks,
  authenticate: { ...hooks.authenticate, service: { authenticate: () => ({ principal: {} }) } },
};

/**
 * The framework's document of an app that serves the given apis, each `{ fastify, docs, service }`: its `index` and
 * its `fastify-docs` module, and whether it is the service api. `inner` is an app `transformObject` that runs on the result; `openapi` is the version the
 * app's options say.
 */
export async function nativeDocument(apis, { openapi = "3.1.0", inner } = {}) {
  resetScenario();

  const app = Fastify();
  const transformObject = apis.reduce(
    (previous, { docs }) => docs.contractSwaggerTransformObject(previous),
    inner,
  );

  await app.register(swagger, {
    openapi: { openapi, info: { title: "app", version: "1" } },
    transformObject,
  });

  for (const { fastify, service } of apis) {
    await app.register(
      fastify.plugin,
      service ? { handlers: SERVICE_HANDLERS, hooks: SERVICE_HOOKS } : { handlers, hooks },
    );
  }

  await app.ready();

  try {
    return app.swagger();
  } finally {
    await app.close();
  }
}
