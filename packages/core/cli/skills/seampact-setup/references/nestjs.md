<!-- Generated from docs/backend/nestjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# NestJS

Page: https://jubasse.github.io/seampact/backend/nestjs/

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- `experimentalDecorators` set in `tsconfig.json`;
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install NestJS and seampact. The Fastify platform is refused at boot.

```sh
npm install @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

In `seampact.config.yaml`, add the targets. To use yup or class-validator instead of zod, see [Switch the validator](https://jubasse.github.io/seampact/configuration/validators/).

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

The request is checked with [zod](https://jubasse.github.io/seampact/types-and-validation/zod/) by default, and the types come from [TypeScript types](https://jubasse.github.io/seampact/types-and-validation/typescript-types/). [yup](https://jubasse.github.io/seampact/types-and-validation/yup/) and [class-validator](https://jubasse.github.io/seampact/types-and-validation/class-validator/) also work: see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. Decorators and the module come from `server/notes`.

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
