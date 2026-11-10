# Next.js from one contract

`contract/api.yaml` describes a small notes api. seampact generates the Next.js route handler and the React (TanStack Query) client from it, into `src/__generated__`. One app rule, in `src/input-rules.ts`, refuses a title of only spaces, which the contract cannot say.

The api and the page live in the same app: the catch-all route is `src/app/v1/[[...path]]/route.ts` (Node.js runtime), the page is `src/app/page.tsx`.

Run these in this folder, after `pnpm install` at the root of the repository.

```sh
cp .env.example .env   # the api URL the page calls
pnpm generate          # writes src/__generated__ from the contract
pnpm build             # next build
pnpm start             # the app on http://localhost:3000
pnpm e2e               # starts `next start` on a free port and calls it with the generated client
```

The api answers a blank title with a 400 body that names the rule:

```json
{ "code": "api.schema_invalid", "issues": [{ "in": "body", "pointer": "/title", "rule": "app.titleNotBlank" }] }
```

To change the api, edit `contract/api.yaml`, run `pnpm generate` again, then fix what `pnpm check:types` reports in `src/`. In your own app you run `npx seampact generate`. The generated folder is not committed here: CI generates it, type-checks, builds and runs `pnpm e2e` on every change.

- The base URL is never generated: `src/notes.ts` reads `NEXT_PUBLIC_API_URL`, and `next.config.ts` refuses to build when it is unset, and `notes.ts` throws at runtime. See [Point the client at your backend](../../docs/frontend/backend-url.md).
- The client imports with `.js` and the server without, so each links its own types entry (`types`, `types-nextjs`).
- This example builds with webpack: the workspace packages ship TypeScript sources that import with `.js` specifiers, and Turbopack does not map them. From npm they are compiled and Turbopack builds too.

Backend guide: [Next.js](../../docs/backend/nextjs.md).
