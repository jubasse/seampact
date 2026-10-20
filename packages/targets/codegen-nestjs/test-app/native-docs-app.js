// A NestJS app around the generated boundaries of the apis it is given, for the native docs test: one controller per
// api binds every operation its module exports, `createDocument` writes the framework's document, and each api's
// `withContractComponents` adds its components to the config. Nothing is served; plain JavaScript, copied next to
// the compiled generated tree, so it imports the generated modules by relative path.
import "reflect-metadata";
import { Controller, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ApiOkResponse, ApiProperty, DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

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

// A class of the app named like a contract schema, which a scanned response type makes `createDocument` write.
function shadowingController(schemaName) {
  const Shadow = { [schemaName]: class {} }[schemaName];

  ApiProperty({ type: String })(Shadow.prototype, "unrelated");

  class ShadowController {
    shadowed() {}
  }

  const descriptor = Object.getOwnPropertyDescriptor(ShadowController.prototype, "shadowed");

  ApiOkResponse({ type: Shadow })(ShadowController.prototype, "shadowed", descriptor);
  Controller("shadow")(ShadowController);

  return ShadowController;
}

// An app that serves the given apis, each `{ nest, docs }`: its `nestjs` module and its `nestjs-docs` module;
// `shadowSchemaName` adds a class of the app with that name. `write` makes the document, and the app closes after.
async function withDocsApp(apis, shadowSchemaName, write) {
  class DocsModule {}

  Module({
    imports: apis.map(({ nest }) => nest.SeampactModule.forRoot(NO_HOOKS)),
    controllers: [
      ...apis.map(({ nest }) => controllerOf(nest)),
      ...(shadowSchemaName === undefined ? [] : [shadowingController(shadowSchemaName)]),
    ],
  })(DocsModule);

  const app = await NestFactory.create(DocsModule, { logger: false });

  try {
    return write(app);
  } finally {
    await app.close();
  }
}

function baseConfig(openapi) {
  return { ...new DocumentBuilder().setTitle("app").setVersion("1").build(), openapi };
}

/**
 * The framework's document of an app that serves the given apis: each api's `withContractComponents` adds its
 * components to the config, and each api's `assertContractComponents` runs on the result. `openapi` is the version
 * the app's config says.
 */
export async function nativeDocument(apis, openapi = "3.1.0", shadowSchemaName = undefined) {
  return withDocsApp(apis, shadowSchemaName, (app) => {
    const config = apis.reduce(
      (current, { docs }) => docs.withContractComponents(current),
      baseConfig(openapi),
    );
    const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false });

    for (const { docs } of apis) docs.assertContractComponents(document);

    return document;
  });
}

/** The framework's document of an app that serves one api, written by that api's `createContractDocument`. */
export async function contractDocument(api, shadowSchemaName = undefined) {
  return withDocsApp([api], shadowSchemaName, (app) =>
    api.docs.createContractDocument(app, baseConfig("3.1.0"), { autoTagControllers: false }),
  );
}
