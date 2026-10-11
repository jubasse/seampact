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

- Branches are `feature/<id>-<slug>`; open a pull request to `main`. Do not commit on `main`.
- Dependencies are pinned to exact versions; GitHub Actions are pinned by commit SHA with the version in a comment.
- Add a changeset (`pnpm changeset`) for a change that affects a package's version.
- Toolchain choices are recorded in `docs/adr/0001-toolchain.md`.
