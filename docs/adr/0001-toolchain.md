# ADR 0001: Toolchain

Status: accepted

## Context

The monorepo needs a strict, reproducible toolchain before any package exists. Every later package should get typecheck, lint, format, tests and CI by adding a directory under `packages/`. Dependencies are pinned by exact version and CI actions by commit SHA (brief section 17.7). Nothing is published to npm until the project is complete (amendment A3).

## Decisions

### Package manager: pnpm

Options: npm workspaces, pnpm, Yarn.

Choice: pnpm 12, pinned through `packageManager`. Its strict, non-flat `node_modules` catches undeclared dependencies between packages, which matters for a monorepo whose packages must stay independent (amendment A2). The lockfile is deterministic, `--frozen-lockfile` is the CI contract, and the default `minimumReleaseAge` delays freshly published versions, which limits supply-chain exposure. `save-exact=true` keeps pins exact.

### Language and runtime: TypeScript 6 on Node 24

ESM only (`NodeNext`), strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Node 24 is pinned by `.nvmrc` and `engines`. TypeScript 6 is used rather than 7 (native compiler) because the surrounding tools are validated against the JavaScript implementation; moving to 7 is a separate, reversible change. Packages run `tsc --noEmit`; project references are not needed until packages emit build output.

### Lint and format: Biome

Options: ESLint flat config + Prettier, Biome.

Choice: Biome. One tool and one config file for both lint and format, no plugin matrix to pin and keep compatible, and fast enough to run on every gate. The trade-off is a smaller rule set than ESLint's ecosystem; if a needed rule is missing, a targeted ESLint pass can be added later without replacing Biome's formatter.

### Test runner: Vitest

TypeScript and ESM work without extra transforms, the API is Jest-compatible, and watch mode is fast. Tests live next to sources as `*.test.ts` in each package.

### Versions: Changesets

Options: Changesets, Lerna, release-please, manual.

Choice: Changesets, with `access: restricted` and no publish workflow or npm token. It manages per-package versions and changelogs from small files in review, which suits several packages that version independently. Releases are tags cut from `main`; publication is deferred until the project is complete.

### CI

One job named `ci` runs `pnpm install --frozen-lockfile` then `pnpm gate` on push and pull request to `main`. Actions are pinned by full commit SHA with the version in a comment. The `ci` job is the check that branch protection will require.
