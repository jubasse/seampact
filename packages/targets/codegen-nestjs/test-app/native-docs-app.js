// A NestJS app around the generated boundaries of the apis it is given, for the native docs test: one controller per
// api binds every operation its module exports, `createDocument` writes the framework's document, and each api's
// `withContractComponents` adds its components to the config. Nothing is served; plain JavaScript, copied next to
// the compiled generated tree, so it imports the generated modules by relative path.
import "reflect-metadata";
import { Controller, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const NO_HOOKS = {};

// The operation decorators an api's `nestjs` module exports: functions that carry an `input` param decorator.
function operationDecorators(apiModule) {
  return Object.entries(apiModule).filter(
    ([, exported]) => typeof exported === "function" && typeof exported.input === "function",
  );
}

function controllerOf(apiModule) {
  class ApiController {}

  for (const [name, decorator] of operationDecorators(apiModule)) {
    const prototype = ApiController.prototype;

    Object.defineProperty(prototype, name, {
      value: function handle() {},
      writable: true,
      configurable: true,
    });
    decorator.input()(prototype, name, 0);

    // The operation decorator replaces the method in place, through the descriptor it is given.
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);

    decorator()(prototype, name, descriptor);
    Object.defineProperty(prototype, name, descriptor);
  }

  Controller()(ApiController);

  return ApiController;
}

/**
 * The framework's document of an app that serves the given apis, each `{ nest, docs }`: its `nestjs` module and its
 * `nestjs-docs` module. `openapi` is the version the app's config says.
 */
export async function nativeDocument(apis, openapi = "3.1.0") {
  class DocsModule {}

  Module({
    imports: apis.map(({ nest }) => nest.SeampactModule.forRoot(NO_HOOKS)),
    controllers: apis.map(({ nest }) => controllerOf(nest)),
  })(DocsModule);

  const app = await NestFactory.create(DocsModule, { logger: false });
  const config = apis.reduce((current, { docs }) => docs.withContractComponents(current), {
    ...new DocumentBuilder().setTitle("app").setVersion("1").build(),
    openapi,
  });

  try {
    return SwaggerModule.createDocument(app, config, { autoTagControllers: false });
  } finally {
    await app.close();
  }
}
