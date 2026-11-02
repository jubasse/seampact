# Contributing

## Setup

Requirements: Node 24 (see `.nvmrc`) and pnpm 12 (pinned by `packageManager`; `corepack enable` selects it).

For `jvm/`: JDK 21 and 25. Gradle runs through `jvm/gradlew` on the newest, `-PtestJdk=21` or `25` picks the test JDK, and the foojay resolver provides a missing one.

For `python/`: Python 3.12 or later and [uv](https://docs.astral.sh/uv/), installed with `pip install uv==0.13.6` or the official installer at that version (python/pyproject.toml pins `required-version`). Set `UV_PYTHON_INSTALL_BIN=0` so uv adds no `python` links to `~/.local/bin` when it installs an interpreter. Then, from `python/`:

```sh
uv sync --locked --all-packages
```

The Python gates, run from `python/` (CI runs them on Python 3.12 and the latest):

```sh
uv run --locked ruff check
uv run --locked ruff format --check
uv run --locked mypy
uv run --locked pyright
uv run --locked pytest
```

`pytest <package>/<tests-dir>` runs one package, for example `pytest fastapi/fastapi_tests` or `pytest ir/tests`. Each Python target also has an end-to-end consumer under `scripts/consumers/targets/<target>/` (`fastapi`, `drf`), run by `.github/workflows/p7-<target>.yml`: it installs the wheels `uv build --all-packages --wheel` writes into a Python without Node, generates, then runs the HTTP suite with `pnpm vitest run --config scripts/consumers/targets/<target>/suite/vitest.config.ts`. Read the workflow for the exact steps.

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
