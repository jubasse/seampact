# Laravel and Vue from one contract

`contract/api.yaml` describes a small notes api. seampact generates the Laravel server (`api/app/Generated`) and the Vue (TanStack Query) client (`src/__generated__`) from it. One app rule, in `api/app/Rules`, refuses a title of only spaces, which the contract cannot say.

Two configs, since two runners generate: `seampact.config.yaml` (the Node CLI, the Vue client) and `api/seampact.config.template.yaml` (Composer, the Laravel server).

Run these in this folder, after `pnpm install` at the root of the repository. You need Composer and PHP 8.3.36 or later, 8.4.27 or later, or 8.5.12 or later (the floors of `api/composer.json`).

```sh
cp .env.example .env                  # the api URL the Vue app calls
(cd api && composer update)           # installs seampact/laravel from the repo's php/ folder
pnpm generate                         # writes both generated folders from the contract
pnpm start                            # the api on http://localhost:8000 (PORT changes it)
pnpm dev:web                          # the Vue app, calling VITE_API_URL (see .env)
pnpm e2e                              # starts the api and calls it with the generated client
```

The api answers a blank title with a 400 body that names the rule:

```json
{ "code": "api.schema_invalid", "issues": [{ "in": "body", "pointer": "/title", "rule": "app.titleNotBlank" }] }
```

The rule is a Laravel validation rule, tagged for `createNote` in `api/app/Providers/NotesServiceProvider.php`. The class name gives the rule id.

To change the api, edit `contract/api.yaml`, run `pnpm generate` again, then fix what `pnpm check:types` and the controller report. The generated folders are not committed here: CI generates them, type-checks, builds and runs `pnpm e2e` on every change.

`pnpm generate:api` packs the contract with `seampact bundle` into a local git repository (`.contract-repo`), because the Composer runner reads a bundle, not a folder. A real app pins a published bundle: see [Sharing a contract](../../docs/features/sharing-contracts.md). The `composer.json` here points at the repo's `php/` folder; yours uses `composer require seampact/laravel`. See the [Laravel guide](../../docs/backend/laravel.md).

The base URL is never generated: `src/notes.ts` reads it from `VITE_API_URL`. See [Point the client at your backend](../../docs/frontend/backend-url.md).
