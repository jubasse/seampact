<!-- Generated from docs/backend/fastify.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Fastify

Page: https://jubasse.github.io/seampact/backend/fastify/

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Fastify and seampact. The Fastify target checks bodies with Ajv validators it generates, so there is no `zod` and no validators target.

```sh
npm install fastify ajv @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-fastify
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
  - id: server
    use: "@seampact/codegen-fastify"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

With no `validators` entry, the request is checked with [Ajv](https://jubasse.github.io/seampact/types-and-validation/ajv/); [zod](https://jubasse.github.io/seampact/types-and-validation/zod/) and [yup](https://jubasse.github.io/seampact/types-and-validation/yup/) also work. The types come from [TypeScript types](https://jubasse.github.io/seampact/types-and-validation/typescript-types/): see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and the plugin come from `server/notes`. Fastify has no decorators: leave `experimentalDecorators` out of `tsconfig.json`.

## Wire it in

Create `src/main.ts`.

```ts
import Fastify from "fastify";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = Fastify();

NotesFastify.collectFrameworkRoutes(app);

await app.register(NotesFastify.plugin, {
  handlers: { NotesEndpoints: notesHandlers },
  hooks: notesHooks(),
});

app.setNotFoundHandler((request, reply) => {
  if (NotesFastify.renderPreRoutingError(request, reply)) return;

  reply.code(404).send({ message: "not found" });
});

await app.listen({ port: 3000 });
```

- `collectFrameworkRoutes` must come right after `Fastify()`. The plugin uses it at start to find the routes you add outside the contract.
- Register the plugin without a prefix. Another prefix is refused at boot.
- The not-found handler answers unknown routes in the contract's error format.
- For a public api, leave `hooks` out.

Check the types.

```sh
npx tsc -p .
```

You see no output.
