# Your first API

You write a contract in YAML. seampact generates the types, the validators and the server routes. You write the handlers. Words you do not know are in the [glossary](../concepts/glossary.md). At the end, a notes API runs on your machine.

Steps 1 to 3 are the same for every stack. In step 4, open the section of your server: NestJS, Express, Fastify, Hono, AdonisJS, Spring Boot, Laravel, Symfony, FastAPI, Django REST Framework or Django Ninja. The other sections stay closed.

Run every command in the `notes-app` folder.

## 1. Install

On Node.js, follow [Install](01-install.md): it creates the `notes-app` folder, installs the `seampact` command and runs `init`. On Spring Boot, Laravel, Symfony and Python, install through your build tool and start from your own app: [install in other ecosystems](install-other-ecosystems.md). The packages of your server come in step 4.

## 2. Write the contract

The contract describes one collection of records, `notes`, with four operations. On Node, `init` wrote `contract/api.yaml`: replace it with this file. On the other stacks, create it. Keep the first line `init` writes, the editor modeline (`# yaml-language-server: ...`): it lets your editor check the contract.

```yaml
api:
  name: notes
  version: 1
  kind: product
  maturity: provisional
  summary: A small notes api.

pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }

schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }
      createdAt: { type: string, format: date-time }
  CreateNote:
    type: object
    required: [title]
    properties:
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }

surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          list: { paging: { cursor: { maxLimit: 50 } } }
          get: {}
          create: { input: CreateNote }
          delete: {}
```

What each block does:

- `api` names the api and gives its version. `version: 1` makes the `/v1` in every path. `kind: product` says this is an API for end users and their clients; it is the default, and the other value is `service`, for an internal API with a caller identity. `maturity: provisional` says the API may still change; the values are `experimental`, `provisional` and `stable`.
- `pagings` defines how a list pages. Here a client sends `cursor` and `limit` in the query. The body is the array of records (`$items`) and the next page goes in a `Link` header (`$next`).
- `schemas` holds the shapes of your data. `Note` is what the API returns. `CreateNote` is what a client sends to create one.
- `surfaces` (a [surface](../concepts/glossary.md) is an entry point with a path prefix) holds the routes under a path prefix. `/v{version}` becomes `/v1`. `access` says who may call them: `public` means anyone, and the sentence says why.
- `routes.notes` is a collection. `ops` picks the standard operations: `list` (`GET /v1/notes`, up to 50 records per page), `get` (`GET /v1/notes/{noteId}`), `create` (`POST /v1/notes`) and `delete` (`DELETE /v1/notes/{noteId}`).

A contract with one api needs no `workspace.yaml`: seampact reads `api.yaml` in the folder. [The shape of a contract](../contract/01-basics.md) explains each block further. The contract is plain YAML: every server below reads this same file.

Check it. `seampact lint` is `npx seampact lint` on Node; the other stacks run it with the compiler binary: see [commands per stack](../features/commands-per-stack.md).

```sh
seampact lint
```

You see `Linted 1 api(s): 0 error(s), 0 warning(s).`

## 3. Generate the code

The config tells seampact where the contract is and what to generate. It lives in `seampact.config.yaml`, at the root of the app. Every stack shares two keys:

```yaml
sources:
  notes:
    path: ./contract
targets: []
```

- `sources.notes.path` is the folder of the contract. The api inside it is named `notes`, which is the `api.name` of the contract.
- Each entry of `targets` (a [target](../concepts/glossary.md) entry) is one kind of output. `use` names its generator. A server entry lists the apis it serves (`apis: [notes]` on Node, `api: notes` elsewhere) and sets its own options.
- `outDir` is the folder of the generated code. Each stack has its own: see [Generated files](../configuration/config-file.md#generated-files).

Every key is in [the config reference](../configuration/reference.md). The entry of your server is in step 4. After it, `seampact generate` writes the code and the OpenAPI document (`openapi/notes.yaml`). On Node you type `npx seampact generate`; on the other stacks the build or another command runs it: see [commands per stack](../features/commands-per-stack.md). Commit the generated files on every stack except Spring Boot: `seampact check` fails later if they drift from the contract. Never edit them by hand.

## 4. Write your first handler

A handler is the code of one operation: a controller method, a route function or a view, depending on the server. The generated code gives you one interface per resource and calls your handler after it has checked the request. Open the section of your server. Each one has the install lines, the config entry, a minimal handler and the wiring, copied from its guide.

<details>
<summary>Node: NestJS</summary>

Install NestJS and seampact. NestJS decorators need `experimentalDecorators` in `tsconfig.json`.

```sh
npm install @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "experimentalDecorators": true
  },
  "include": ["src"]
}
```

Add the targets to `seampact.config.yaml`, then generate. The files appear in `src/__generated__`.

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

```sh
npx seampact generate
```

Write the handlers in `src/notes-controller.ts`. This one keeps the notes in memory. A real app reads `input.query.cursor` to page.

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

Mount the generated module in `src/app-module.ts`. A public api needs no hooks, so `forRoot()` takes none.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot()],
  controllers: [NotesController],
})
export class AppModule {}
```

Start the app in `src/main.ts`. `configureApp` makes bad JSON and unknown routes answer in the contract's error format.

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

Install `tsx` to run TypeScript, check the types and start the app. It listens on port 3000.

```sh
npm install --save-dev tsx typescript @types/node
npx tsc -p .
npx tsx src/main.ts
```

Next: [the NestJS guide](../backend/nestjs.md) (access hooks, tests, Docker).

</details>

<details>
<summary>Node: Express</summary>

Install Express and seampact.

```sh
npm install express@5 zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @types/express@5 @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-express
```

Add the targets to `seampact.config.yaml`, then generate. The files appear in `src/__generated__`.

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
    use: "@seampact/codegen-express"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

```sh
npx seampact generate
```

Write the handlers in `src/notes-handlers.ts`. A real app reads `input.query.cursor` to page.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesExpress from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesExpress.NotesEndpoints = {
  listNotes(input) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  },

  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },

  createNote(input) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  },

  deleteNote(input) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  },
};
```

Wire them in `src/main.ts`. A public api needs no hooks.

```ts
import express from "express";
import * as NotesExpress from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";

const app = express();

app.use(NotesExpress.router({ handlers: { NotesEndpoints: notesHandlers } }));
app.use(NotesExpress.preRoutingErrorHandler);

NotesExpress.checkFrameworkRoutes(app);

app.listen(3000);
```

Install `tsx` to run TypeScript, then start the app. It listens on port 3000.

```sh
npm install --save-dev tsx typescript @types/node
npx tsx src/main.ts
```

Next: [the Express guide](../backend/express.md) (access hooks, tests, Docker).

</details>

<details>
<summary>Node: Fastify</summary>

Install Fastify and seampact. Fastify has no decorators: leave `experimentalDecorators` out of `tsconfig.json`.

```sh
npm install fastify ajv @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-fastify
```

Add the targets to `seampact.config.yaml`, then generate. The files appear in `src/__generated__`.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-fastify"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

```sh
npx seampact generate
```

Write the handlers in `src/notes-handlers.ts`. A real app reads `input.query.cursor` to page.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesFastify from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesFastify.NotesEndpoints = {
  listNotes() {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  },

  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },

  createNote(input) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  },

  deleteNote(input) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  },
};
```

Wire them in `src/main.ts`. A public api needs no hooks.

```ts
import Fastify from "fastify";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";

const app = Fastify();

NotesFastify.collectFrameworkRoutes(app);

await app.register(NotesFastify.plugin, {
  handlers: { NotesEndpoints: notesHandlers },
});

app.setNotFoundHandler((request, reply) => {
  if (NotesFastify.renderPreRoutingError(request, reply)) return;

  reply.code(404).send({ message: "not found" });
});

await app.listen({ port: 3000 });
```

Install `tsx` to run TypeScript, then start the app. It listens on port 3000.

```sh
npm install --save-dev tsx typescript @types/node
npx tsx src/main.ts
```

Next: [the Fastify guide](../backend/fastify.md) (access hooks, tests, Docker).

</details>

<details>
<summary>Node: Hono</summary>

Install Hono and seampact.

```sh
npm install hono @hono/node-server zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-hono
```

Add the targets to `seampact.config.yaml`, then generate. The files appear in `src/__generated__`.

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
    use: "@seampact/codegen-hono"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

```sh
npx seampact generate
```

Write the handlers in `src/notes-handlers.ts`. A real app reads `input.query.cursor` to page.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesHono from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesEndpoints: NotesHono.NotesEndpoints = {
  listNotes() {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  },

  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },

  createNote(input) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  },

  deleteNote(input) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  },
};
```

Wire them in `src/main.ts`. A public api needs no hooks.

```ts
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import * as NotesHono from "./__generated__/server/notes/index.js";
import { notesEndpoints } from "./notes-handlers.js";

const app = new Hono();

app.onError((error, c) => NotesHono.renderContractError(c, error));

NotesHono.registerRoutes(app, {
  handlers: { NotesEndpoints: notesEndpoints },
  clientAddress: (c) => getConnInfo(c).remote.address,
});

NotesHono.checkFrameworkRoutes(app);

serve({ fetch: app.fetch, port: 3000 });
```

Install `tsx` to run TypeScript, then start the app. It listens on port 3000.

```sh
npm install --save-dev tsx typescript @types/node
npx tsx src/main.ts
```

Next: [the Hono guide](../backend/hono.md) (access hooks, tests, Docker).

</details>

<details>
<summary>Node: AdonisJS</summary>

Create the app with the AdonisJS API starter, and answer the prompts with the defaults.

```sh
npm init adonisjs@latest notes-app -- --kit=api --pkg=npm
cd notes-app
```

Install seampact.

```sh
npm install @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-adonis
```

The generated code does not compile with the starter's `lib` and unused-variable checks. Replace `tsconfig.json`.

```json
{
  "extends": "@adonisjs/tsconfig/tsconfig.app.json",
  "compilerOptions": {
    "rootDir": "./",
    "jsx": "react",
    "outDir": "./build",
    "lib": ["ES2024"],
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

Create `seampact.config.yaml` (the contract goes in `contract/` of this app), then generate. The files appear in `src/__generated__`.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-adonis"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

```sh
npx seampact generate
```

Write the controller in `app/controllers/notes_controller.ts`.

```ts
import { randomUUID } from 'node:crypto'
import type * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
import * as Notes from '../../src/__generated__/types/notes/index.js'

const notes = new Map<string, Notes.schemas.Note>()

export default class NotesController implements NotesAdonis.NotesEndpoints {
  listNotes(input: Notes.ListNotesInput) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } }
  }

  getNote(input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId)

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }

    return { status: Notes.Status.Ok, body: note }
  }

  createNote(input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body }

    notes.set(note.noteId, note)

    return { status: Notes.Status.Created, body: note }
  }

  deleteNote(input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }

    return { status: Notes.Status.NoContent }
  }
}
```

Replace `start/routes.ts`. A public api needs no hooks.

```ts
import router from '@adonisjs/core/services/router'
import * as NotesAdonis from '../src/__generated__/server/notes/index.js'

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
})
```

Edit `app/exceptions/handler.ts` so bad JSON and unknown routes under `/v1` answer in the contract's error format. Add the import at the top, and the `if` line in `handle`.

```ts
import * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
```

```ts
  async handle(error: unknown, ctx: HttpContext) {
    if (await NotesAdonis.renderPreRoutingError(error, ctx)) return undefined

    return super.handle(error, ctx)
  }
```

Check the types and start it. The app listens on port 3333 by default; the starter's `.env` sets it.

```sh
npx tsc --noEmit
node ace serve
```

Next: [the AdonisJS guide](../backend/adonisjs.md) (access hooks, tests, Docker).

</details>

<details>
<summary>Java: Spring Boot</summary>

Add the plugin and the dependencies to `build.gradle.kts`. The plugin is on the Gradle Plugin Portal and on Maven Central; until the Portal approves it, add Maven Central to the plugin repositories in `settings.gradle.kts`.

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
```

```kotlin
plugins {
    java
    id("org.springframework.boot") version "4.1.1"
    id("io.github.jubasse.seampact")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("io.github.jubasse:seampact-hooks")
}
```

Add the entry to `seampact.config.yaml`. Generated code stays out of Git: the build writes it.

```yaml
outDir: build/generated/sources/seampact/main
sources:
  notes:
    path: ./contract
targets:
  - id: notes
    use: io.github.jubasse:seampact-spring-boot
    api: notes
    options: { package: com.example.notes.api }
```

Maven? Add the runtime and the plugin to `pom.xml` instead, at the same version (set `<seampact.version>` once in `<properties>`), and set `outDir` to `target/generated-sources/seampact`. [The Spring Boot guide](../backend/spring-boot.md#with-maven) has the details.

```xml
<dependency>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-spring-runtime</artifactId>
  <version>${seampact.version}</version>
</dependency>
```

```xml
<plugin>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-maven-plugin</artifactId>
  <version>${seampact.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>generate</goal>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

`./gradlew build` (or `./mvnw verify`) generates the code, then compiles it with yours. Write a controller. `notes` is your own store.

```java
@RestController
class NotesController implements NotesEndpoints {
    @Override
    @GetNote
    public GetNoteResult getNote(GetNoteInput input) {
        Note note = notes.get(input.path().noteId());

        return note == null
                ? new GetNoteErrors.ApiNotFound()
                : new GetNoteResult.Status200(note);
    }
}
```

Spring finds the generated configuration class by component scan when `package` sits under your application's package. Otherwise import it.

```java
@SpringBootApplication
@Import(NotesSeampactConfiguration.class)
class NotesApplication {
}
```

Start it. The app listens on port 8080.

```sh
./gradlew bootRun
```

Next: [the Spring Boot guide](../backend/spring-boot.md) (hooks, tests, Docker).

</details>

<details>
<summary>PHP: Laravel</summary>

Install seampact from Packagist.

```sh
composer require seampact/laravel
```

Add the entry to `seampact.config.yaml`, then generate. The classes go into `App\Generated\Notes`.

```yaml
outDir: app/Generated
sources:
  notes:
    path: ./contract
targets:
  - id: notes
    out: Notes
    use: seampact/laravel
    api: notes
    options: { rules: seampact-consistent }
```

```sh
vendor/bin/seampact generate
# or
php artisan seampact:generate
```

Write a controller that implements the generated interface, and bind the interface in a service provider.

```php
final class NotesController implements NotesEndpoints
{
    public function getNote(GetNoteRequest $request): GetNoteResult
    {
        $note = $this->notes->get($request->contractInput()->path->noteId);

        return $note === null
            ? GetNoteErrors::apiNotFound()
            : new GetNoteResponse200($note);
    }
}
```

```php
$this->app->bind(NotesEndpoints::class, NotesController::class);
```

List the generated provider, and call the route macro once.

```php
// bootstrap/providers.php
return [
    App\Generated\Notes\Laravel\NotesSeampactServiceProvider::class,
];

// bootstrap/app.php, with use Illuminate\Support\Facades\Route;
->withRouting(
    web: __DIR__.'/../routes/web.php',
    then: fn () => Route::seampact('notes'),
)
```

Start it. The app listens on port 8000.

```sh
php artisan serve
```

Next: [the Laravel guide](../backend/laravel.md) (hooks, tests, Eloquent).

</details>

<details>
<summary>PHP: Symfony</summary>

Install seampact from Packagist.

```sh
composer require seampact/symfony
```

Add the entry to `seampact.config.yaml`. Map `outDir` in `composer.json` (`"App\\": "src/"` covers `src/Generated`). Then generate.

```yaml
outDir: src/Generated
sources:
  contract: { path: contract }
targets:
  - id: notes
    out: Notes
    use: seampact/symfony
    api: notes
```

```sh
vendor/bin/seampact generate
```

Implement the generated interface as a service, and mark each method with `#[SeampactOperation]`.

```php
use App\Generated\Notes\GetNoteErrors;
use App\Generated\Notes\GetNoteInput;
use App\Generated\Notes\GetNoteResponse200;
use App\Generated\Notes\GetNoteResult;
use App\Generated\Notes\Symfony\SeampactOperation;
use App\Generated\Notes\NotesEndpoints;

final class NotesController implements NotesEndpoints
{
    #[SeampactOperation('getNote')]
    public function getNote(GetNoteInput $input): GetNoteResult
    {
        $note = $this->notes->find($input->path->noteId);

        return $note === null
            ? GetNoteErrors::apiNotFound()
            : new GetNoteResponse200($note);
    }
}
```

List the api's bundle and import its routes.

```php
// config/bundles.php
App\Generated\Notes\Symfony\NotesSeampactBundle::class => ['all' => true],
```

```yaml
# config/routes/seampact.yaml
seampact_notes:
    resource: notes
    type: seampact
```

Start it. The app listens on port 8000.

```sh
php -S 127.0.0.1:8000 -t public
```

Next: [the Symfony guide](../backend/symfony.md) (hooks, tests, Doctrine).

</details>

<details>
<summary>Python: FastAPI</summary>

Install seampact from PyPI, with the compiler it needs to read a contract folder.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-fastapi[generate]"
pip install "seampact-ir[compiler]"
```

Add the entry to `seampact.config.yaml`, then generate. The code goes into `generated/notes/`.

```yaml
outDir: generated
openapi: none
sources:
  notes:
    path: ./contract
targets:
  - id: notes
    out: notes
    use: pypi:seampact-fastapi
    api: notes
    options: { rules: seampact-consistent }
```

```sh
seampact generate
```

Write a handler class and the factory that builds it. `NoteRepository` and `get_notes` are your own code.

```python
from fastapi import Depends
from generated.notes.operations import GetNoteErrors, GetNoteRequest, GetNoteResponse200, GetNoteResult


class NotesEndpoints:
    def __init__(self, notes: NoteRepository) -> None:
        self.notes = notes

    async def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        note = await self.notes.get(request.input.path.note_id)

        if note is None:
            return GetNoteErrors.api_not_found()

        return GetNoteResponse200(note)


def notes_endpoints(notes: NoteRepository = Depends(get_notes)) -> NotesEndpoints:
    return NotesEndpoints(notes)
```

Bind the contract in your app. A public api needs no hooks. Make `bind_notes()` the last call, after your own middleware.

```python
from fastapi import FastAPI
from generated.notes.fastapi import NotesHandlerFactories, bind_notes

app = FastAPI()

bind_notes(
    app,
    handlers=NotesHandlerFactories(notes=notes_endpoints),
)
```

Start it. The app listens on port 8000.

```sh
uvicorn main:app
```

Next: [the FastAPI guide](../backend/fastapi.md) (hooks, tests, Deploy).

</details>

<details>
<summary>Python: Django REST Framework</summary>

Install seampact from PyPI, with the compiler it needs to read a contract folder.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-drf[generate]"
pip install "seampact-ir[compiler]"
```

Add the entry to `seampact.config.yaml`, then generate. The code goes into `generated/notes/`.

```yaml
outDir: generated
openapi: none
sources:
  notes:
    path: ./contract
targets:
  - id: notes
    out: notes
    use: pypi:seampact-drf
    api: notes
    options: { rules: seampact-consistent }
```

```sh
seampact generate
# or
python manage.py seampact_generate
```

Write a handler class and the factory that builds it.

```python
from django.http import HttpRequest
from generated.notes.operations import GetNoteErrors, GetNoteRequest, GetNoteResponse200, GetNoteResult


class NotesHandlers:
    def __init__(self, request: HttpRequest) -> None:
        self.request = request

    def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        note = Note.objects.filter(pk=request.input.path.note_id).first()

        if note is None:
            return GetNoteErrors.api_not_found()

        return GetNoteResponse200(body=to_contract(note))


def notes_handlers(request: HttpRequest) -> NotesHandlers:
    return NotesHandlers(request)
```

Two files of your Django project. A public api needs no hooks.

```python
# settings.py
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "seampact.django",
]

MIDDLEWARE = [
    "generated.notes.django.NotesBoundary",
    "django.middleware.common.CommonMiddleware",
]

SEAMPACT = {
    "notes": {
        "handlers": {"notes": "notes.api.notes_handlers"},
    },
}
```

```python
# urls.py
urlpatterns = [
    path("", include("generated.notes.urls")),
    path("admin/", admin.site.urls),
]
```

Start it. The app listens on port 8000.

```sh
python manage.py runserver
```

Next: [the Django REST Framework guide](../backend/drf.md) (hooks, tests, Deploy). For production, serve with gunicorn or uvicorn.

</details>

<details>
<summary>Python: Django Ninja</summary>

Install seampact from PyPI, with the compiler it needs to read a contract folder.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-ninja[generate]"
pip install "seampact-ir[compiler]"
```

Add the entry to `seampact.config.yaml`, then generate. The code goes into `generated/notes/`.

```yaml
outDir: generated
openapi: none
sources:
  notes:
    path: ./contract
targets:
  - id: notes
    out: notes
    use: pypi:seampact-ninja
    api: notes
    options: { views: sync }
```

```sh
seampact generate
# or
python manage.py seampact_generate
```

Write a handler class and the factory that builds it.

```python
from django.http import HttpRequest
from generated.notes.operations import GetNoteErrors, GetNoteRequest, GetNoteResponse200, GetNoteResult


class NotesHandlers:
    def __init__(self, request: HttpRequest) -> None:
        self.request = request

    def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        note = Note.objects.filter(pk=request.input.path.note_id).first()

        if note is None:
            return GetNoteErrors.api_not_found()

        return GetNoteResponse200(to_contract(note))


def notes_handlers(request: HttpRequest) -> NotesHandlers:
    return NotesHandlers(request)
```

Three files of your Django project. A public api needs no hooks.

```python
# settings.py
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "ninja",
    "seampact.django",
]

MIDDLEWARE = [
    "generated.notes.django.NotesBoundary",
    "django.middleware.common.CommonMiddleware",
]
```

```python
# api.py
from generated.notes.ninja import NotesHandlerFactories, bind_notes
from ninja import NinjaAPI

api = NinjaAPI(urls_namespace="notes")
bind_notes(
    api,
    prefix="",
    handlers=NotesHandlerFactories(notes=notes_handlers),
)
```

```python
# urls.py
urlpatterns = [
    path("", api.urls),
    path("admin/", admin.site.urls),
]
```

Start it. The app listens on port 8000.

```sh
python manage.py runserver
```

Next: [the Django Ninja guide](../backend/ninja.md) (hooks, tests, Deploy). For production, serve with gunicorn or uvicorn.

</details>


A public api needs no hooks. [Hooks](../concepts/glossary.md) are the functions that check who calls; the guide of your server shows them.

## 5. Run it

Start the app with the command in your section. In another terminal, create a note. Replace `3000` with your port: `3333` on AdonisJS, `8080` on Spring Boot, `8000` on Laravel, Symfony and Python.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":"Buy milk"}'
```

You see `201` and the note with its `noteId`. `curl localhost:3000/v1/notes` lists it.

Send an empty title.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":""}'
```

You see `400` and an `application/problem+json` body whose `issues` names `/title`. The generated validators refused it before your handler ran.

Test a route from code: every guide has a "Test your routes" section ([NestJS](../backend/nestjs.md#test-your-routes), [Express](../backend/express.md#test-your-routes), [Fastify](../backend/fastify.md#test-your-routes), [Hono](../backend/hono.md#test-your-routes), [AdonisJS](../backend/adonisjs.md#test-your-routes), [Spring Boot](../backend/spring-boot.md#test-your-routes), [Laravel](../backend/laravel.md#test-your-routes), [Symfony](../backend/symfony.md#test-your-routes), [FastAPI](../backend/fastapi.md#test-your-routes), [Django REST Framework](../backend/drf.md#test-your-routes), [Django Ninja](../backend/ninja.md#test-your-routes)).

Something fails? See [troubleshooting](../troubleshooting/README.md).

Next: [call it from React](call-it-from-react.md). More on your server: its guide, linked at the end of your section.
