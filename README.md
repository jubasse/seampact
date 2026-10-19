# seampact

Declare API semantics once. Derive framework-native boundaries from them.

seampact is a contract system for HTTP APIs. You describe an API in plain YAML files: its endpoints, schemas, errors, who may call each route and what each route requires. seampact compiles them into a canonical intermediate representation (IR), and everything else is derived from it: an OpenAPI 3.1 document, lint, a compatibility diff between two versions, and generated code for the frameworks you use.

**Status: development phase.** The reference contract already runs end to end on NestJS, Express 4 and 5, Fastify 5, AdonisJS 6 and 7 and Hono 4, with the TypeScript types, zod validators and the `fetch` client. No package is published to npm, Maven Central or Packagist yet, and nothing can be installed. The design decisions are recorded in [`docs/adr/`](docs/adr/).

## What seampact generates, and what it leaves to you

seampact generates boundaries, not implementations.

- **Generated:** named types, validators, the route table, one handler interface per resource (or tag, or operation) with exact input and output types, typed clients, derived errors and headers, and the utilities that place the access and validation checks around your controller: a decorator per operation in NestJS, a composed annotation in Spring, a FormRequest and middleware in Laravel, an attribute, a listener and a value resolver in Symfony, a listener and a decorated provider in API Platform.
- **Yours:** the controllers, which implement the generated interfaces, what a handler does, where data lives, how a credential is checked, how a right is decided and which tenant a request belongs to. seampact never generates a controller, and everything it generates goes to one directory, `__generated__` by default.

seampact is not a framework. Generated code uses your framework's own mechanisms (guards, interceptors and exception filters in NestJS, interceptors, argument resolvers and `ProblemDetail` in Spring, Form Requests and API Resources in Laravel, listeners and normalizers in Symfony) and never replaces them. Which OpenAPI documents you get is your choice, per app: seampact's document (the default for an app that serves routes; a frontend with client targets only writes none unless it asks), your framework's own document (`@nestjs/swagger`, springdoc, API Platform's) completed by the opt-in `nativeDocs` artefact so it agrees with the contract, both, or none. seampact never turns your framework's own generation off unless you ask, and a monorepo can also write one document across its apps.

Access is checked through three generated, typed hooks: authenticate, decide and resolve scope. You answer them with the library you already use (Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates, Symfony Voters, Spring Security) or with your own code. Your application refuses to start while an identity, right, rule or scope has no hook, or a route has no handler. Or keep your framework's own access rules: turn the access hooks off and seampact exports each route's access for them to enforce.

seampact imposes nothing: not a wire format, a page shape, error codes, header names, a versioning scheme, a permission model, a validator, a client library or a code style. Where it needs a value to work, it has a default you can rename; everything else comes from your contract or from opt-in packs. What it does demand is explicitness: every route states who may call it, and every exception states its reason.

By default a response is the bare payload and an error is an RFC 9457 `application/problem+json` body, with default error codes you can rename or replace with your own (`TASK_NOT_FOUND` works). Paged lists declare their own parameter names and page shape, or take them from a pack. Bodies are JSON, forms or multipart uploads, responses may be file downloads or redirects, and a value a third party shapes freely can be declared opaque. Envelopes, JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring `Page`, or your own house format come from opt-in convention packs.

## Package map

You install the core, then only the generators your project uses. Installing the CLI pulls no code generator.

Already running end to end today: the core, `codegen-ts`, `codegen-zod`, `codegen-yup`, `codegen-class-validator`, `codegen-fetch`, `codegen-nestjs`, `codegen-express`, `codegen-fastify`, `codegen-adonis` and `codegen-hono`, with the signed-webhook and in-memory idempotency helpers. Every other package below is planned for 1.0 unless a row says it comes later.

### Core (npm)

| Package | What it does |
|---|---|
| `@seampact/cli` | the `seampact` command: `init`, `compile`, `check`, `lint`, `diff`, `generate`, `bundle`, and `explain`, which prints one operation whole with where each part comes from |
| `@seampact/compiler` | reads the YAML, reports errors with file, line and column, and produces the IR |
| `@seampact/spec` | the JSON Schemas of the YAML files, one per file and fragment kind for your editor, and of the IR, with their TypeScript types |
| `@seampact/openapi` | writes the OpenAPI 3.1 documents your configs ask for (one per api or declared document, or one merged across a monorepo's apps), with what OpenAPI cannot say as published `x-seampact-*` extensions |
| `@seampact/lint` | lint rules over the IR, and the API to write your own |
| `@seampact/diff` | classifies changes between two versions as additive or breaking, per direction |
| `@seampact/codegen-core` | the API code generators are written against |

### Code generators for TypeScript (npm)

| You want | Install |
|---|---|
| types only | `@seampact/codegen-ts` |
| validators | `@seampact/codegen-zod`, `@seampact/codegen-yup` or `@seampact/codegen-class-validator` |
| a typed `fetch` client | `@seampact/codegen-fetch` |
| a server boundary | `@seampact/codegen-nestjs`, `@seampact/codegen-fastify`, `@seampact/codegen-express` or `@seampact/codegen-adonis`, plus `@seampact/hooks` unless the target vendors its types |
| a frontend client (planned) | `@seampact/codegen-react`, `@seampact/codegen-angular` or `@seampact/codegen-vue` |
| a Web-standard server boundary (Hono 4) | `@seampact/codegen-hono` |
| mock handlers for tests and local work (planned) | `@seampact/codegen-msw` |

A server generator does not install a validator generator. You choose one and link the two in your app's `seampact.config.yaml`, where you also turn each generated artefact on or off. The CLI checks the combination against a published compatibility matrix and, when it does not work, names the ones that do.

`codegen-class-validator` works on `codegen-nestjs` only, and the app must load `reflect-metadata` once at startup (`import "reflect-metadata"` in its entry file) for the decorators to work.

Each app of a repository (frontend, backend, service) has its own `seampact.config.yaml`; a monorepo can add a root one that lists the apps and shares contract sources. An app that only needs the OpenAPI document installs no generator at all, and an app that wants no seampact document says so.

### Java and PHP

These run with no Node.js installed. The standalone compiler binary runs `init`, `compile`, `check`, `lint` (core rules), `diff`, `explain` and `bundle`, so a Java or PHP team can own a contract repository without Node.js. The Gradle and Maven plugins read `seampact.config.yaml` or the same keys in their own DSL.

| Framework | Install |
|---|---|
| Spring Boot | the Gradle plugin `io.github.jubasse.seampact` or the Maven plugin `io.github.jubasse:seampact-maven-plugin`, and `io.github.jubasse:seampact-hooks` unless the target vendors its types |
| Laravel | `seampact/laravel` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| Symfony | `seampact/symfony` as a development dependency, and `seampact/hooks` unless the target vendors its types |
| API Platform | `seampact/api-platform` as a development dependency, and `seampact/hooks` unless the target vendors its types |

### Which generators combine

Every generator renders the default format and every format and paging style your contract or a pack declares, including your own page shapes: formats are data in the contract, not code in a generator. What differs is how each one plugs into its framework and what it links to. Supported framework versions are listed per release in `@seampact/spec`'s `compatibility/matrix.json`, and the CLI refuses a combination the matrix records as incompatible, and warns on a framework version it has not tested.

| Generator | Produces | Links to | Formats mapped onto |
|---|---|---|---|
| `codegen-ts` | types | nothing | not applicable: payload types only |
| `codegen-zod`, `codegen-yup` | validators (Standard Schema) | provides `validators` | not applicable: payloads only |
| `codegen-class-validator` | DTO classes with decorators | provides `validators` | not applicable: payloads only |
| `codegen-fetch` | typed client | provides `client` | the client's response readers |
| `codegen-nestjs` | per-operation decorators, guard, interceptor and input decorators around your controllers | `validators`: zod, yup or class-validator | exception filters and interceptors |
| `codegen-fastify` | server boundary | `validators`: zod or yup, or Ajv without a link | route hooks |
| `codegen-express` | server boundary for Express 4 and 5 | `validators`: zod or yup | middleware |
| `codegen-adonis` | server boundary for AdonisJS 6 and 7 | `validators`: zod or yup (VineJS planned) | middleware and exception handler |
| `codegen-hono` | server boundary for Hono 4 on Web-standard `Request` and `Response` | `validators`: zod or yup | middleware |
| `codegen-react` (planned) | hooks for TanStack Query, RTK Query or SWR, chosen with the `query` option | `client`: fetch | through the fetch client |
| `codegen-vue` (planned) | plain composables, or with `query: tanstack` or `query: pinia-colada` | `client`: fetch | through the fetch client |
| `codegen-angular` (planned) | injectable services over `HttpClient`, and with `state: ngrx` or `state: ngrx-signals` typed actions and effects, or a Signal Store feature | nothing | its own response readers |
| `codegen-msw` (planned) | mock handlers for Mock Service Worker | `types` | not applicable: mocks the contract's own responses |
| Spring Boot plugin | composed annotations, interceptor and argument resolver around your controllers, with Bean Validation | nothing | `ProblemDetail`, Spring Data `Page` |
| `seampact/laravel` | routes, middleware and Form Requests around your controllers | nothing | API Resources and paginators |
| `seampact/symfony` | route loader, attributes, a listener, a value resolver and Validator constraints around your controllers | nothing | normalizers |
| `seampact/api-platform` | resource metadata, DTOs, a listener and a decorated provider around your providers and processors | nothing | API Platform's serializer, JSON-LD and Hydra |

In an app config, a link names the other entry's `id`: `link: { validators: validators }` for a server, `link: { client: client }` for React or Vue.

### Setting up a server target

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

**NestJS.** Import the generated module with your hooks, and start the app with `rawBody: true` so signed routes see the bytes that were signed.

```ts
@Module({ imports: [TasksNest.SeampactModule.forRoot(tasksHooks())], controllers: [TasksController] })
export class AppModule {}

const app = await NestFactory.create(AppModule, { rawBody: true });
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

### Mobile and Capacitor

Today, mobile and Capacitor apps use the TypeScript types, the zod validators and the `fetch` client. The `fetch` client accepts an injected `fetch`, which is how a Capacitor app sends its calls through native HTTP. React Native and Expo need a `crypto.randomUUID` polyfill until the client takes an injected key generator. Ionic and Capacitor apps are web apps, so they will use the React, Angular or Vue targets once those land (planned).

### Optional packages

| Package | Use it when |
|---|---|
| `@seampact/pack-crud-rights` | you want a `<resource>.<op>` right on every route the `ops` shorthand generates, `batch` included, without declaring each one |
| `@seampact/pack-api-platform` | your API Platform api serves JSON-LD items, Hydra pages and Hydra errors |
| `@seampact/pack-laravel` | your api serves Laravel API Resources and paginators |
| `@seampact/pack-spring` | your api serves Spring Data `Page` bodies |
| `@seampact/pack-jsonapi` | your api speaks JSON:API |
| `@seampact/pack-hal` | your api serves HAL |
| `@seampact/nestjs-casl` | your NestJS app decides rights with CASL |
| `seampact/laravel-spatie` | your Laravel app decides rights with spatie/laravel-permission |
| `@seampact/signed-webhooks`, and its Java and PHP equivalents | you receive Stripe-style or GitHub-style signed webhooks and want the signature checked for you; other senders (Standard Webhooks, Slack) are verified by your own hook with their own library |
| `@seampact/http-suite` | you write your own server target and want to prove it against the shared HTTP suite |

## Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in its `seampact.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.

## What seampact does not do

- Generate business logic, persistence, an authentication check or an authorization decision.
- Provide a server framework, or a TypeScript API to write contracts: YAML is the only way to declare one. An importer from an existing OpenAPI document is planned for v3.
- Impose right names, roles, a permission model, a tenancy scheme, a wire format or a code style.
- Model WebSocket, Server-Sent Events, gRPC or GraphQL. The IR leaves room for them; see [ADR 0014](docs/adr/0014-room-for-real-time-and-rpc.md).

## Roadmap after 1.0

In this order, each step reusing what the one before built:

1. Web-standard server targets on the Hono adapter: Next.js route handlers, Bun, Deno, Cloudflare Workers.
2. Mobile clients: Kotlin first (Android, Ktor client, Kotlin Multiplatform), then Swift, then Dart for Flutter.
3. Python: FastAPI, then Django REST Framework or Django Ninja; Flask on demand.
4. More JVM frameworks on the Spring Boot core: Quarkus, Micronaut, Ktor.
5. Go: `net/http` handlers, then Gin, Chi and Echo.
6. .NET: ASP.NET Core.
7. Rust: Axum and Actix Web.
8. Front extras: an axios client variant and Angular reactive-form validators.
9. Much later: Ruby on Rails, Svelte and SvelteKit, Solid. Until then Rails apps read the OpenAPI document, and Svelte and Solid apps use the TypeScript client and zod.

## Design decisions

The ADRs cite product decisions by id (`A<n>`); [`docs/decisions.md`](docs/decisions.md) states each one.

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-toolchain.md) | toolchain |
| [0002](docs/adr/0002-grammar.md) | YAML grammar |
| [0003](docs/adr/0003-schema-language.md) | schema language |
| [0004](docs/adr/0004-ir-shape.md) | IR shape |
| [0005](docs/adr/0005-ir-evolution.md) | IR evolution |
| [0006](docs/adr/0006-compiler-pass-pipeline.md) | compiler passes |
| [0007](docs/adr/0007-cross-language-naming.md) | cross-language naming |
| [0008](docs/adr/0008-convention-packs-and-extensions.md) | convention packs and user extensions |
| [0009](docs/adr/0009-modular-packaging-and-target-composition.md) | packages and how generators compose |
| [0010](docs/adr/0010-native-generators.md) | Java and PHP generators and the standalone compiler |
| [0011](docs/adr/0011-distribution.md) | bundles, the app config and installs |
| [0012](docs/adr/0012-access-hooks.md) | authenticate, decide and resolve-scope hooks |
| [0013](docs/adr/0013-signed-webhooks.md) | inbound signed webhooks |
| [0014](docs/adr/0014-room-for-real-time-and-rpc.md) | room for real-time and RPC |
| [0015](docs/adr/0015-codegen-determinism-and-conformance.md) | deterministic generation and the conformance suite |
| [0016](docs/adr/0016-nestjs-target.md) | the NestJS server target |
| [0017](docs/adr/0017-fastify-target.md) | the Fastify server target |
| [0018](docs/adr/0018-express-target.md) | the Express server target |
| [0019](docs/adr/0019-adonis-target.md) | the AdonisJS server target |
| [0020](docs/adr/0020-hono-target.md) | the Hono server target and the Web-standard adapter |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
