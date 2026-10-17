# Contributing

## Setup

Requirements: Node 24 (see `.nvmrc`) and pnpm 12 (pinned by `packageManager`; `corepack enable` selects it).

```sh
pnpm install --frozen-lockfile
```

## The gate

```sh
pnpm gate
```

It runs typecheck, lint, the format check and the tests, and fails on any error. CI runs the same command. `pnpm format` rewrites files to the expected style.

## Conventions

- Git flow: never commit directly on `develop` or `main`; both are protected and require the `ci` check.
- Dependencies are pinned to exact versions; GitHub Actions are pinned by commit SHA with the version in a comment.
- Add a changeset (`pnpm changeset`) for a change that affects a package's version. Releases are cut from `release/<version>`.
- Toolchain choices are recorded in `docs/adr/0001-toolchain.md`.
- The compiler flow, the folder layout and the recipes for a compile rule, an IR member, a target and a pack are in `ARCHITECTURE.md`.

## Git flow

- Features: branch `feat/<feature>` from `develop`, open a pull request to `develop`, squash merge.
- Releases: branch `release/<version>` from `develop`, open a pull request to `main`, merge commit. Then merge `main` back into `develop` (merge commit).
- Hotfixes: branch `hotfix/<version>` from `main`, open a pull request to `main` (merge commit). Then merge it back into `develop` (merge commit).
- `develop` is the default branch until 1.0; from 1.0 it is `main`.
