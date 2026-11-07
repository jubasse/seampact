# NestJS

`@seampact/codegen-nestjs` generates decorators, a module and a filter around your NestJS controllers, and checks access, input and replies for every route of the contract. You write the controller methods and the [hooks](node-hooks.md). NestJS 12 on the Express platform is supported; see [Supported versions](../supported-versions.md). The step-by-step first project is in [Your first API](../getting-started/your-first-api.md).

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](../getting-started/your-first-api.md);
- `experimentalDecorators` set in `tsconfig.json`;
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install NestJS and seampact. The Fastify platform is refused at boot.

```sh
npm install @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

In `seampact.config.yaml`, add the targets. To use yup or class-validator instead of zod, see [Validators](../configuration/validators.md).

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: validators
    use: "@seampact/codegen-zod"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-nestjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. Decorators and the module come from `server/notes`.

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-controller.ts`.

```ts
import { randomUUID } from "node:crypto";
import { Controller } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.listNotes()
  listNotes(@NotesNest.listNotes.input() input: Notes.ListNotesInput) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  }

  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  }

  @NotesNest.createNote()
  createNote(@NotesNest.createNote.input() input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  }

  @NotesNest.deleteNote()
  deleteNote(@NotesNest.deleteNote.input() input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  }
}
```

Rules for a contract method:

- Keep `@Controller()` without a path, and do not add `@HttpCode` or `@Header`. The contract sets paths, statuses and headers, and the app refuses to start otherwise.
- A service can also throw. `throw new NotFoundException()` answers the operation's 404 code, when it declares one. For any declared code, throw `new NotesNest.ContractException(code, params)`: it is typed with the api's codes and their params. A plain `HttpException` for a code that needs params answers 500.
- seampact's filter catches these exceptions before your global filters, so a global `@Catch(NotFoundException)` filter does not see them on a contract route.

### Who is calling

`@<operation>.principal()` gives the caller: what your authenticate hook returned, typed with the identity's principal schema. `@<operation>.scopes()` gives one entry per scope, as your resolver returned it. A public operation has no `principal()`, and an operation in no scope has no `scopes()`.

```ts
@NotesNest.getNote()
getNote(
  @NotesNest.getNote.input() input: NotesNest.HandlerInputs["getNote"],
  @NotesNest.getNote.principal() principal: NotesNest.OperationAccess["getNote"]["principal"],
) {
  const ownerId = principal.userId;
```

The input typed with `HandlerInputs` carries the same `principal` and `scopes`, read-only. Spreading or serialising it leaves them out. The scope's `value` is `unknown`: narrow it.

### Read one part of the input

Instead of the whole input, take the parts you use: `@<operation>.path()`, `.query()`, `.headers()` and `.body()`. Each exists when the operation declares that part. The request is checked once, whichever parts you take.

```ts
@NotesNest.getNote()
getNote(@NotesNest.getNote.path() path: Notes.GetNoteInput["path"]) {
  const note = notes.get(path.noteId);
```

## Wire it in

Create `src/app-module.ts`. Pass your hooks to `forRoot`.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";
import { notesHooks } from "./notes-hooks.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot(notesHooks())],
  controllers: [NotesController],
})
export class AppModule {}
```

For a public api, write `forRoot()`. Import `forRoot` once per api.

Create `src/main.ts`. `configureApp` installs the JSON parser of the contract routes and the filter that make bad JSON and unknown routes answer in the contract's error format. Call it before `listen`.

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { AppModule } from "./app-module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule);

NotesNest.configureApp(app);

await app.listen(3000);
```

Check the types.

```sh
npx tsc -p .
```

You see no output.

### Hooks that need providers

When your hooks need NestJS providers, build them with `forRootAsync`.

```ts
NotesNest.SeampactModule.forRootAsync({
  imports: [UsersModule],
  inject: [UsersService],
  useFactory: (users: UsersService) => notesHooks(users),
});
```

### Your own JSON parser and filters

On the contract routes, `configureApp` reads JSON bodies at each route's limit, accepts a plain value such as `"text"` (the contract then checks it) and keeps the bytes of signed routes. Your own routes keep NestJS's default JSON parser: strict, 100 KB. To change it, pass its options: `configureApp(app, { appJsonParser: { limit: "5mb" } })`.

- Do not add a JSON parser of your own: the app refuses to start, because it would read the contract bodies first, or never run.
- With two apis, call each api's `configureApp`, and pass `appJsonParser` to the first call only.
- With a global filter of your own, do the steps yourself: `app.useBodyParser("json", { limit, strict: false, verify: NotesNest.keepRawBody })`, then call the api's `renderPreRoutingError` from your filter. A contract body that no parser read answers 500, with a log naming `configureApp`.

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`. Pass the object to `forRoot`, as in `app-module.ts` above.

### Use NestJS's own auth

Call your guard logic from a decide hook and let it throw `UnauthorizedException` or `ForbiddenException`: seampact answers the right's first declared denial code. See [Use your framework's own auth](node-hooks.md#use-your-frameworks-own-auth).

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. Needs the validators target. A handler result is typed already. |
| `frameworkEtag` | `strip` | `strip` removes an ETag the framework adds to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Answer the api's 404 for a path under its base path that no route serves, or a method it does not serve. `false` leaves those requests to your app. |
| `reply` | `handler` | `handler`: seampact writes the reply when your handler returns. `interceptor`: your global interceptors (`app.useGlobalInterceptors(...)`, `APP_INTERCEPTOR`) map the result first, and seampact checks the mapped value against the contract. |

Every option of this target is in the [config reference](../configuration/reference.md#codegen-nestjs). Entry keys shared by the Node servers: [`mount`](../configuration/reference.md#mount), [`frameworkRoutes`](../configuration/reference.md#framework-routes) and the [boot check](../configuration/reference.md#boot-check).

`forRoot(hooks, { logger, responses, bodyValidation, unboundOperations })` changes some of these at startup, for example `forRoot(notesHooks(), { bodyValidation: process.env.NODE_ENV !== "production" })`. A `responses()` decorator on a controller or a method still wins. A wrong value stops the app at boot.

- `logger` takes `warn` and `error` functions. By default seampact writes through NestJS's `Logger` under the context `Seampact:<api>`, so `app.useLogger(...)` applies.
- `bodyValidation: true` needs the validators generated with the target option `bodyValidation: true`.
- `unboundOperations: "warn"` is for tests (below).

## Rate limits

A 429 from `@nestjs/throttler` works as is. If the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the throttler's `Retry-After` (seconds or an HTTP date), read from the reply or from the exception. Without a usable header, the client gets a logged 500: throw `new NotesNest.ContractException(code, params)` instead.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](../contract/05-lists.md).

## Docs and OpenAPI

To show the contract in `@nestjs/swagger`, set `artefacts: { nativeDocs: true }` on the `server` entry, generate again, and build the document with one call. It adds the contract schemas and stops the app if one of your classes replaces one.

```ts
const document = NotesNest.createContractDocument(app, config);
```

The full setup is in [OpenAPI and docs](../configuration/openapi-and-docs.md#serve-swagger-on-nestjs).

## Test your routes

Build a testing module, set the app up with `configureApp` as `main.ts` does, and send requests with `supertest`. Send the credential your authenticate hook reads.

```ts
const moduleRef = await Test.createTestingModule({
  imports: [NotesNest.SeampactModule.forRoot(testHooks, { unboundOperations: "warn" })],
  controllers: [NotesController],
}).compile();
const app = moduleRef.createNestApplication<NestExpressApplication>();

NotesNest.configureApp(app);
await app.init();

const reply = await request(app.getHttpServer()).get(`/v1/notes/${noteId}`).set("authorization", "Bearer test-user");
```

- `unboundOperations: "warn"` lets a testing module hold only some controllers. The app starts, logs the operations no controller serves, and their routes answer the api's 404. Leave it out of your app module: there, a missing operation stops the boot.
- To replace your hooks in an existing module, use `overrideProvider(NotesNest.SEAMPACT_HOOKS).useValue(testHooks)`.

To test a controller method without HTTP, call it with a plain input and the caller. Nothing checks them on a direct call.

```ts
const reply = await new NotesController().getNote({ path: { noteId } }, { userId });
```

### Debug locally

With `NODE_ENV=development`, an exception your handler throws goes to NestJS's exception filters, which log its stack. seampact logs its message and the file and line it came from. Otherwise, under `responses: strict` the client gets the api's 500. Under `responses: warn` the framework's reply goes out as written and the violation is logged.

## Deploy

Behind a proxy, trust only your proxy's addresses on the Express platform, so `req.ip` is the caller's. Your hooks get `req.ip` as the client address.

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);

app.set("trust proxy", ["loopback", "10.0.0.0/8"]);
```

The proxy forwards the contract's paths as they are (`/v1/notes`). Strip only a prefix you added in front, such as `/api`. To serve the api under a prefix, set `mount: /api` on the target entry instead of `setGlobalPrefix`. If you keep a global prefix, exclude the contract routes; a `RouterModule` path on the controller's module is refused the same way.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix.

In Docker, keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files. Check your variables at boot with `ConfigModule.forRoot({ validate })`.

The server also checks itself at start. Fix the lines it prints, then start again. 

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `no JSON parser read the body of '<operation>'` (a 500 at run time) | Call `configureApp(app)` before `listen`. |
| `setGlobalPrefix('<prefix>') prefixes <route>` | Exclude the contract routes in `setGlobalPrefix`, or use `mount`. |
| `@Controller('<path>') on <Controller> prefixes the contract route` | Use `@Controller()` without a path. |
| `the NestJS platform is '<x>'` | Use `@nestjs/platform-express`. |

Every other start message: [NestJS boot errors](../troubleshooting/boot.md#nestjs).

## Limits

- A query list in the `brackets` form is refused by `generate`.
- An identity header written on a response is refused (`identity.response.header.unsupported`).
- A sort key or a nested input field restricted by a right is refused (`paging.sortKey.restricted.unsupported`, `fieldRight.nestedPointer.unsupported`).

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server). For 428 and 412 on versioned writes, see [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.
