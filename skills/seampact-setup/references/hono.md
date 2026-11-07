<!-- Generated from docs/backend/hono.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Hono

Page: https://jubasse.github.io/seampact/backend/hono/

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Hono and seampact. You do not need `experimentalDecorators`.

```sh
npm install hono @hono/node-server zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-hono
```

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
    use: "@seampact/codegen-hono"
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

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and `registerRoutes` come from `server/notes`.

## Wire it in

Create `src/main.ts`.

```ts
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import * as NotesHono from "./__generated__/server/notes/index.js";
import { notesEndpoints } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = new Hono();

app.onError((error, c) => NotesHono.renderContractError(c, error));

NotesHono.registerRoutes(app, {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (c) => getConnInfo(c).remote.address,
});

NotesHono.checkFrameworkRoutes(app);

serve({ fetch: app.fetch, port: 3000 });
```

- `onError` makes a failing handler answer in the contract's error format.
- `clientAddress` gives your hooks the caller's address. Without it, they get none.
- Call `registerRoutes` on an app without `basePath()`. A base path is refused at boot.
- `checkFrameworkRoutes` must run after the last route is added and before the app serves.
- For a public api, leave `hooks` out.

If your own middleware answers 401, 403 or 429 on a contract route, render it in the contract's format with `renderPreRoutingError`:

```ts
app.onError(async (error, c) => (await NotesHono.renderPreRoutingError(c, error)) ?? NotesHono.renderContractError(c, error));
```

Check the types.

```sh
npx tsc -p .
```

You see no output.
