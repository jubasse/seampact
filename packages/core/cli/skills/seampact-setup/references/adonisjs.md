<!-- Generated from docs/backend/adonisjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# AdonisJS

Page: https://jubasse.github.io/seampact/backend/adonisjs/

## Set up

You need:

- Node.js 24 or later;
- a contract in `contract/`, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

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

The starter already depends on `@vinejs/vine`, which the generated server validates with. There is no validators target. Create `seampact.config.yaml`.

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

With no `validators` entry, the request is checked with [VineJS](https://jubasse.github.io/seampact/types-and-validation/vinejs/); [zod](https://jubasse.github.io/seampact/types-and-validation/zod/) and [yup](https://jubasse.github.io/seampact/types-and-validation/yup/) also work. The types come from [TypeScript types](https://jubasse.github.io/seampact/types-and-validation/typescript-types/): see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The routes come from `server/notes`.

### What changes for AdonisJS 6

Nothing in this page: the same generated code and the same files run on AdonisJS 6. Only the starter you create differs.

AdonisJS 6 works, but AdonisJS no longer ships security fixes for it: move to AdonisJS 7. See [Supported versions](https://jubasse.github.io/seampact/supported-versions/) for how long it stays supported.

## Wire it in

Replace `start/routes.ts`. Pass your hooks as `hooks`; for a public api, leave them out.

```ts
import router from '@adonisjs/core/services/router'
import * as NotesAdonis from '../src/__generated__/server/notes/index.js'
import { notesHooks } from '../src/notes-hooks.js'

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
  hooks: notesHooks(),
})
```

- `controllers` has one entry per generated `*Endpoints` interface. Each is a lazy import of a module whose default export is your controller class.
- Call `registerRoutes` outside any `router.group()` with a prefix: a contract route under a prefix answers 500 and reports why.
- A route of yours beside the contract's must stay off the api's paths (`/v1`), unless `frameworkRoutes` allow-lists it.
- The starter already registers the body parser (`@adonisjs/core/bodyparser_middleware`) as router middleware and accepts `application/json`, which the generated routes need. Without that, every route that takes a body answers 500. Signed routes read the raw body through it.

Edit `app/exceptions/handler.ts` so bad JSON and unknown routes under `/v1` answer in the contract's error format. Add the import at the top, and the `if` line in `handle`. With several apis, call each api's helper.

```ts
import * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
```

```ts
  async handle(error: unknown, ctx: HttpContext) {
    if (await NotesAdonis.renderPreRoutingError(error, ctx)) return undefined

    return super.handle(error, ctx)
  }
```

Check the types.

```sh
npx tsc --noEmit
```

You see no output.
