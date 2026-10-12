# ADR 0001: Toolchain

Status: accepted

## Context

The monorepo needs a strict, reproducible toolchain before any package exists. Every later package should get typecheck, lint, format, tests and CI by adding a directory under `packages/`. Dependencies are pinned by exact version and CI actions by commit SHA (brief section 17.7). Nothing is published to npm until the project is complete (amendment A3).

## Decisions

### Package manager: pnpm

Options: npm workspaces, pnpm, Yarn.

Choice: pnpm 12, pinned through `packageManager`. Its strict, non-flat `node_modules` catches undeclared dependencies between packages, which matters for a monorepo whose packages must stay independent (amendment A2). The lockfile is deterministic, `--frozen-lockfile` is the CI contract, and the default `minimumReleaseAge` delays freshly published versions, which limits supply-chain exposure. `save-exact=true` keeps pins exact.

### Language and runtime: TypeScript 6 on Node 24

Options: TypeScript 6, TypeScript 7 (native compiler), plain JavaScript with JSDoc types.

Choice: TypeScript 6 on Node 24. ESM only (`NodeNext`), strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Node 24 is pinned to an exact version in `.nvmrc`, which CI reads through `node-version-file`; `engines` sets the floor. TypeScript 6 is used rather than 7 (native compiler) because the surrounding tools are validated against the JavaScript implementation; moving to 7 is a separate, reversible change. Packages run `tsc --noEmit`, and a root `tsconfig.json` typechecks `vitest.config.ts`; project references are not needed until packages emit build output.

### Lint and format: Biome

Options: ESLint flat config + Prettier, Biome.

Choice: Biome. One tool and one config file for both lint and format, no plugin matrix to pin and keep compatible, and fast enough to run on every gate. The trade-off is a smaller rule set than ESLint's ecosystem; if a needed rule is missing, a targeted ESLint pass can be added later without replacing Biome's formatter.

### Test runner: Vitest

Options: Jest, `node:test`, Vitest.

Choice: Vitest. TypeScript and ESM work without extra transforms, the API is Jest-compatible, and watch mode is fast. Tests live next to sources as `*.test.ts` in each package.

### Versions: Changesets

Options: Changesets, Lerna, release-please, manual.

Choice: Changesets, with `access: restricted` and no publish workflow or npm token. It manages per-package versions and changelogs from small files in review, which suits several packages that version independently. Releases are tags cut from `main`; publication is deferred until the project is complete.

### CI

One job named `ci` runs `pnpm install --frozen-lockfile` then `pnpm gate` on push and pull request to `main`. Actions are pinned by full commit SHA with the version in a comment. The `ci` job is the check that branch protection will require.

Amended 2026-10-12: git flow, see CONTRIBUTING.md. CI now runs on push and pull request to `main` and `develop`.

## Consequences

- Adding a package needs only a directory under `packages/` with a `typecheck` script; the gate picks it up.
- Biome's smaller rule set may leave gaps. Revisit with a targeted ESLint pass if a needed rule is missing.
- Revisit TypeScript 7 once the surrounding tools support it.
- Exact pins, including the Node version, mean updates are deliberate and reviewed.
