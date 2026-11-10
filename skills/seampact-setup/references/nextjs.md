<!-- Generated from docs/backend/nextjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Next.js

Page: https://jubasse.github.io/seampact/backend/nextjs/

## Set up

You need:

- Node.js 24 or later;
- a Next.js 16 app with the App Router;
- a contract, as in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install seampact.

```sh
npm install zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nextjs
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
    use: "@seampact/codegen-nextjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

The request is checked with [zod](https://jubasse.github.io/seampact/types-and-validation/zod/), and the types come from [TypeScript types](https://jubasse.github.io/seampact/types-and-validation/typescript-types/). To check with [yup](https://jubasse.github.io/seampact/types-and-validation/yup/) instead, use `@seampact/codegen-yup` in the `validators` entry: the rest is the same.

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

The files appear in `src/__generated__`. Their imports have no `.js` extension, as Next.js expects. Types come from `types/notes`. The handlers interface and `routeHandler` come from `server/notes`.

In `next.config.ts`, turn off the trailing-slash redirect, so the contract answers those paths itself.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
```

This setting applies to the whole app: your own pages lose their trailing-slash redirect too. Without it, Next.js redirects `/v1/notes/7/` to `/v1/notes/7` and serves it, where the contract answers 404.

## Wire it in

Build the route handler's options once, in `src/notes-route.ts`.

```ts
import { notesEndpoints } from "./notes-handlers";
import { notesHooks } from "./notes-hooks";

export const notesRouteOptions = {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (request: Request) =>
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim(),
};
```

Then create the catch-all route file under the api's base path, `src/app/v1/[[...path]]/route.ts`.

```ts
import { routeHandler } from "@/__generated__/server/notes";
import { notesRouteOptions } from "@/notes-route";

export const runtime = "nodejs";

const handler = routeHandler(notesRouteOptions);

export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
```

- Export the handler under every method name. A method the contract does not serve then answers the contract's 404, not Next.js's 405.
- `runtime = "nodejs"` is required. On the Edge runtime the route fails to load. If your app sets `cacheComponents: true`, remove this line: Next.js refuses it there, and the route runs on Node.js.
- An api with several base paths needs one route file per base path, each importing the same options.
- For a public api, leave `hooks` out.
- `clientAddress` gives your hooks the caller's address. Without it, they get none. A `Request` does not carry it: behind a proxy, read the last `X-Forwarded-For` entry, as above, and only when the request comes from your proxy. The client writes the earlier entries.

Check the types.

```sh
npx tsc -p .
```

You see no output.

Build and start the app. Turbopack and webpack both work: the generated imports have no extension.

```sh
npx next build
npx next start
```
