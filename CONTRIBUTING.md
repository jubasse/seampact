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

`pytest <package>/<tests-dir>` runs one package, for example `pytest fastapi/fastapi_tests` or `pytest ir/tests`. Each Python target also has an end-to-end consumer under `scripts/consumers/targets/<target>/` (`fastapi`, `drf`), run by `.github/workflows/p7-<target>.yml`: it installs the wheels `scripts/consumers/python/build-wheels.sh` writes (every member but `seampact-compiler`) into a Python without Node, generates, then runs the HTTP suite with `pnpm vitest run --config scripts/consumers/targets/<target>/suite/vitest.config.ts`. Read the workflow for the exact steps.

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

- Git flow: never commit directly on `develop` or `main`; both are protected. A pull request to `develop` merges only when it is up to date with `develop` and its required checks pass: `ci`, `checklist`, and one check per lane (for example `native-ir`, `laravel`, `fastapi`).
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

## Release

- Every package of every ecosystem carries one version. On `release/<version>`, run `node scripts/release/stamp.ts <version>` and commit the result; `node scripts/release/check-version.ts <version>` says what is not at the version yet.
- The `release` workflow does the rest. Run it by hand on the release branch as a dry run first: it builds, checks and installs everything from a local registry, and publishes nothing. A pull request that changes the release path runs the same dry run.
- Then run it from `main` with `dry-run` off. It drafts the GitHub release, waits for one approval of the `release` environment, publishes to the registries, and publishes the GitHub release last. The npm publish takes exactly the tarballs the pack job checked, matched by their SHA-256, and nothing else; Maven Central takes exactly the bundle the JVM build job checked, signed with the release key after the approval, and publishes it once the portal has validated it.
- The JVM build job holds no secret and stages unsigned bundles. A dry run signs them with a throwaway key, by the same script as a real run, and publishes the bundle to a local Central Portal, which a Gradle and a Maven build of the Spring Boot consumer then use. The Gradle plugin goes to the Gradle Plugin Portal, which reviews a new plugin by hand before it is public. A rerun during that review counts the portal's "already exists" answer as published.
- A failed job can be rerun alone: a version already published with the same files is skipped. A full rerun packs again; if it packs other bytes than a version already published, it fails by name and publishes nothing. Fix it with a new patch version.

## CI

- Each lane has its own workflow. A job first checks what the pull request changed; jobs it does not touch are skipped in seconds. The lane's last job is its required check.
- Rows that are slow or rarely break run after the merge, on `develop` (post-merge rows), or every night (drift rows, which test against the latest releases). When one of them fails, `ci-watch` opens an issue. A failed nightly is first rerun once, so a registry outage does not open one.
- `checklist` lints every workflow with actionlint.
- A new workflow reuses the shared actions in `.github/actions/`: `lane-changes` and `lane-aggregate` for the change filter and the required check, `compiler-binary` for the compiler binary, `gradle-retry`, `composer-cache` and `maven-cache` for downloads.
- Caches are saved by pushes to `develop`, the nightly and manual runs; pull requests only read them. The repository has a 10 GB cache limit, and an entry a pull request saved would serve only that pull request. To refresh the caches without waiting for the night, run the workflow by hand on `develop`.

## Dependencies

- Dependabot opens one grouped pull request per ecosystem each week (GitHub Actions, npm, uv, Composer), minor and patch releases only. A new major of a framework changes what seampact supports, so it is done by hand.
- Security updates come as soon as an advisory is published. A floor row tests the oldest version seampact declares, so a security update that would move it above that floor is closed, and its alert dismissed as test-only. The FastAPI guide explains this choice for Starlette, and [Supported versions](docs/supported-versions.md) gives the whole policy.
- `npm audit` runs nightly and on lockfile changes; Python runs `pip-audit` and PHP `composer audit`. An advisory that cannot be fixed here goes under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, with a comment saying why.
