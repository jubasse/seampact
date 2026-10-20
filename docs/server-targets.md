# Setting up a server target

Every server target takes the same two options: `bodyValidation` (check request bodies, off by default) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it. Each target shows the same pattern: a config entry, one registration line per api, and the raw body that signed routes need.

```yaml
# seampact.config.yaml (the same entry for every target, only `use` changes)
targets:
  - id: server
    use: "@seampact/codegen-nestjs" # or codegen-express, codegen-fastify, codegen-adonis
    apis: [tasks]
    options:
      responses: strict # or warn
      bodyValidation: true
    link:
      types: types
      validators: validators
```

**NestJS.** Install `@nestjs/platform-express` (the Fastify platform is refused at boot), `reflect-metadata` and `rxjs`, and set `experimentalDecorators` in `tsconfig.json`. Import the generated module with your hooks, start the app with `rawBody: true` so signed routes see the bytes that were signed, and register `preRoutingFilter`. Without the filter, malformed JSON and unknown routes under the api's prefix answer with NestJS's own error body instead of the contract's format.

```ts
@Module({ imports: [TasksNest.SeampactModule.forRoot(tasksHooks())], controllers: [TasksController] })
export class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: TasksNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(TasksNest.preRoutingFilter);
```

To complete `@nestjs/swagger`'s own document, install `@nestjs/swagger`, turn `artefacts: { nativeDocs: true }` on in the server entry, and wrap the config and the document. The boot check refuses routes the contract does not know, so list the ones Swagger adds under `frameworkRoutes`.

```ts
const config = TasksNest.withContractComponents(
  new DocumentBuilder().setTitle("Tasks").setOpenAPIVersion("3.1.0").build(),
);
const document = SwaggerModule.createDocument(app, config);

TasksNest.assertContractComponents(document);
SwaggerModule.setup("docs", app, document);
```

```yaml
    frameworkRoutes:
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI assets." }
      - { path: "/docs-json", reason: "Swagger JSON." }
      - { path: "/docs-yaml", reason: "Swagger YAML." }
```

**Express 4 and 5.** Mount the generated router, then its error middleware for requests refused before a route matched. The router keeps the raw bytes of signed routes itself; a JSON parser you mount app-wide before it must use the generated `keepRawBody`.

```ts
app.use(TasksExpress.router({ handlers: { TasksEndpoints: tasksHandlers }, hooks: tasksHooks() }));
app.use(TasksExpress.preRoutingErrorHandler);
```

**Fastify 5.** Register the generated plugin. It keeps the raw bytes of signed routes itself.

```ts
await app.register(TasksFastify.plugin, { handlers: { TasksEndpoints: tasksHandlers }, hooks: tasksHooks() });
```

**Hono 4.** Register the routes on the app that serves, and pass the client address your runtime gives (here `@hono/node-server`). The boundary reads the raw bytes of signed routes itself; render refusals raised before a route ran from your `onError`.

```ts
TasksHono.registerRoutes(app, {
  handlers: { TasksEndpoints: tasksHandlers },
  hooks: tasksHooks(),
  clientAddress: (c) => getConnInfo(c).remote.address,
});
app.onError(async (error, c) => (await TasksHono.renderPreRoutingError(c, error)) ?? c.text("error", 500));
```

**AdonisJS 6 and 7.** Register `@adonisjs/core/bodyparser_middleware` as router middleware and list the route's media type in `json.types` of the body parser config: without it every route that takes a body answers 500, failing closed. Register the routes from `start/routes`, one `controllers` entry per generated `*Endpoints` interface, each a lazy import of a module whose default export is your controller class implementing that interface. Signed routes read the raw body through the body parser.

```ts
TasksAdonis.registerRoutes(router, {
  controllers: { TasksEndpoints: () => import("#controllers/tasks_controller") },
  hooks: tasksHooks(),
});
```

In `app/exceptions/handler`, call the generated helper first, once per api:

```ts
override async handle(error: unknown, ctx: HttpContext) {
  if (await TasksAdonis.renderPreRoutingError(error, ctx)) return undefined;

  return super.handle(error, ctx);
}
```

