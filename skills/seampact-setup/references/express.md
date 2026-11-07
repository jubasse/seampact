<!-- Generated from docs/backend/express.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Express

Page: https://jubasse.github.io/seampact/backend/express/

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Express and seampact.

```sh
npm install express@5 zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @types/express@5 @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-express
```

For Express 4, install `express@4` and `@types/express@4` instead. The generated code and your handlers are the same.

In `seampact.config.yaml`, add the targets.

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

The request is checked with [zod](https://jubasse.github.io/seampact/types-and-validation/zod/) here, or [yup](https://jubasse.github.io/seampact/types-and-validation/yup/), and the types come from [TypeScript types](https://jubasse.github.io/seampact/types-and-validation/typescript-types/): see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and the router come from `server/notes`.

## Wire it in

Create `src/main.ts`. Mount the router at the root of the app, without a path: the contract paths already start with `/v1`.

```ts
import express from "express";
import * as NotesExpress from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = express();

app.use(NotesExpress.router({ handlers: { NotesEndpoints: notesHandlers }, hooks: notesHooks() }));
app.use(NotesExpress.preRoutingErrorHandler);

NotesExpress.checkFrameworkRoutes(app);

app.listen(3000);
```

- `router` parses JSON itself, so bad JSON and unknown routes answer in the contract's error format. For a public api, leave `hooks` out.
- `preRoutingErrorHandler` does the same for errors raised by middleware you mount before the router, such as `express.json()` or a rate limiter. A JSON parser you mount before the router needs `verify: NotesExpress.keepRawBody` and `limit: NotesExpress.LARGEST_BODY_LIMIT`.
- `checkFrameworkRoutes` checks the routes you add outside the contract. Express has no start hook: call it once every route is mounted, before `listen`. It throws and names the route it refuses.

Check the types.

```sh
npx tsc -p .
```

You see no output.
