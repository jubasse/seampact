# NestJS and React from one contract

`contract/api.yaml` describes a small notes api. seampact generates the NestJS server and the React (TanStack Query) client from it, into `src/__generated__`. One app rule, in `src/server/input-rules.ts`, refuses a title of only spaces, which the contract cannot say.

Run these in this folder, after `pnpm install` at the root of the repository.

```sh
cp .env.example .env   # the api URL the React app calls
pnpm generate     # writes src/__generated__ from the contract
pnpm start        # the api on http://localhost:3000 (PORT changes it)
pnpm dev:web      # the React app, calling VITE_API_URL (see .env)
pnpm e2e          # starts the server and calls it with the generated client
```

To change the api, edit `contract/api.yaml`, run `pnpm generate` again, then fix what `pnpm check:types` reports in `src/`. `pnpm generate` runs the seampact CLI from this workspace; in your own app you run `npx seampact generate`. The generated folder is not committed here: CI generates it, type-checks, builds and runs `pnpm e2e` on every change.

The base URL is never generated: `src/web/notes.ts` reads it from `VITE_API_URL`. See [Point the client at your backend](../../docs/frontend/backend-url.md).
