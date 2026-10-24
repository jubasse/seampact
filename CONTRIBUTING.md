# Contributing

## Setup

Requirements: Node 24 (see `.nvmrc`) and pnpm 12 (pinned by `packageManager`; `corepack enable` selects it).

For `jvm/`: JDK 21 and 25. Gradle runs through `jvm/gradlew` on the newest, `-PtestJdk=21` or `25` picks the test JDK, and the foojay resolver provides a missing one.

The front consumer tests download Playwright's Chromium headless shell on their first run, into `~/.cache/ms-playwright`.

```sh
pnpm install --frozen-lockfile
```

## The gate

```sh
pnpm gate
```

It runs typecheck, lint, the format check and the tests, and fails on any error. CI runs the same command. `pnpm format` rewrites files to the expected style.

## Conventions

- Git flow: never commit directly on `develop` or `main`; both are protected. The required checks include `ci`, `native-ir`, `hooks-native`, `binary` and `p6-react`.
- Dependencies are pinned to exact versions; GitHub Actions are pinned by commit SHA with the version in a comment.
- Add a changeset (`pnpm changeset`) for a change that affects a package's version. Releases are cut from `release/<version>`.
- Toolchain choices are recorded in `docs/adr/0001-toolchain.md`.
- The main design decisions and their ADRs are listed in [docs/design-decisions.md](docs/design-decisions.md).
- The compiler flow, the folder layout and the recipes for a compile rule, an IR member, a target and a pack are in `ARCHITECTURE.md`.

## Git flow

- Features: branch `feat/<feature>` from `develop`, open a pull request to `develop`, squash merge.
- Releases: branch `release/<version>` from `develop`, open a pull request to `main`, merge commit. Then merge `main` back into `develop` (merge commit).
- Hotfixes: branch `hotfix/<version>` from `main`, open a pull request to `main` (merge commit). Then merge it back into `develop` (merge commit).
- `develop` is the default branch until 1.0; from 1.0 it is `main`.
