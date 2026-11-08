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

For `php/`: PHP and [Composer](https://getcomposer.org/); the versions are in the `p6-php-core.yml` and `p6-laravel.yml` workflows. Then, from `php/<name>` (`ir`, `hooks`, `signed-webhooks`, `codegen`, `laravel`, `symfony`):

```sh
composer install
vendor/bin/phpunit
vendor/bin/phpstan analyse --no-progress
```

The JVM gate of one module is `./gradlew :<module>:check`, run from `jvm/` (for example `:seampact-ir:check`).

The front consumer tests download Playwright's Chromium headless shell on their first run, into `~/.cache/ms-playwright`.

```sh
pnpm install --frozen-lockfile
```

## The gate

```sh
pnpm gate
```

It runs typecheck, lint, the format check and the tests, and fails on any error. `pnpm format` rewrites files to the expected style. The pre-commit hook that `pnpm install` sets up formats the staged files for you; a file with unstaged changes is skipped, so stage whole files. A narrower run while you work is `pnpm vitest run <paths>`, `pnpm typecheck` and `pnpm lint` (which does not check format: `pnpm exec biome check <files>` does).

Two repository checks run in the `checklist` job, and you run them before a PR: `node scripts/checklist/cli.ts check` (the conformance checklist, its proofs and the workflows' job names) and `node scripts/cartography/cli.ts --check` (the generated map `docs/agents/cartography.md`; `--write` regenerates it). `node scripts/package-rules/cli.ts` checks the package manifests and READMEs.

## Conventions

- Git flow: never commit directly on `develop` or `main`; both are protected. The required checks of `develop` are in strict mode: a pull request merges once `ci`, `checklist` and one check per lane (for example `native-ir`, `laravel`, `fastapi`) pass on top of the current `develop`. When `develop` moved, update the branch first; the fast tier makes that rerun short. There is no merge queue: GitHub offers one to organizations only.
- Dependencies are pinned to exact versions; GitHub Actions are pinned by commit SHA with the version in a comment.
- Add a changeset (`pnpm changeset`) for a change that affects a package's version. Releases are cut from `release/<version>`.
- Toolchain choices are recorded in `docs/adr/0001-toolchain.md`.
- The main design decisions and their ADRs are listed in [docs/design-decisions.md](docs/design-decisions.md).
- The compiler flow, the folder layout and the recipes for a compile rule, an IR member, a target and a pack are in `ARCHITECTURE.md`.

## Git flow

- Features: branch `feat/<feature>` from `develop`, open a pull request to `develop`, squash merge. The same holds for `fix/`, `chore/` and `docs/` branches.
- Integration batch: several ready pull requests may land together through one integration branch from `develop`, with one commit per pull request ("<title> (#n)"). Its pull request runs CI once and merges with a merge commit, so `develop` keeps one commit per pull request; the batched pull requests are then closed with a pointer. Rebase merging is disabled.
- Releases: branch `release/<version>` from `develop`, open a pull request to `main`, merge commit. Then merge `main` back into `develop` (merge commit).
- Hotfixes: branch `hotfix/<version>` from `main`, open a pull request to `main` (merge commit). Then merge it back into `develop` (merge commit).
- `develop` is the default branch until 1.0; from 1.0 it is `main`.

## Release

- Every package of every ecosystem carries one version. On `release/<version>`, run `node scripts/release/stamp.ts <version>` and commit the result; `node scripts/release/check-version.ts <version>` says what is not at the version yet.
- The `release` workflow does the rest. Run it by hand on the release branch as a dry run first: it builds, checks and installs everything from a local registry, and publishes nothing. A pull request that changes the release path runs the same dry run.
- Then run it from `main` with `dry-run` off. It drafts the GitHub release, waits for one approval of the `release` environment, publishes to the registries, and publishes the GitHub release last. The npm publish takes exactly the tarballs the pack job checked, matched by their SHA-256, and nothing else; Maven Central takes exactly the bundle the JVM build job checked, signed with the release key after the approval, and publishes it once the portal has validated it.
- npm takes the packages through trusted publishing, so there is no token: each package trusts `release.yml` of `jubasse/seampact` in the `release` environment (`npm trust github <package> --file release.yml --repository jubasse/seampact --environment release --allow-publish`). npm can only trust a package that exists, so a new package is published once by its owner, then gets the same trust.
- The JVM build job holds no secret and stages unsigned bundles. A dry run signs them with a throwaway key, by the same script as a real run, and publishes the bundle to a local Central Portal, which a Gradle and a Maven build of the Spring Boot consumer then use. The Gradle plugin goes to the Gradle Plugin Portal under the same approval, once Central serves the modules it depends on; the portal reviews a new plugin by hand before it is public. A rerun during that review counts the portal's "already exists" answer as published.
- PyPI takes every Python distribution of the workspace, a wheel and an sdist each, and the five `seampact-compiler` wheels, each holding its binary as `SHA256SUMS` lists it. They go out through trusted publishing with PEP 740 attestations, so there is no token. Each distribution is published by its own job from its own GitHub environment, `pypi-<distribution>`, since PyPI takes one pending publisher per workflow and environment; the run's approval of the `release` environment covers them. Rerunning a failed PyPI leg publishes without a new approval, and only the files of the already approved run. Each `seampact-compiler` wheel is also checked against the binary call's `wheels-sha256`. A dry run checks them with `twine check --strict`, publishes them to a local index, installs each one alone from it in a clean venv and imports its top module.
- Release setup for PyPI: create the GitHub environments below, deployment branch `main` only and no reviewer, then register on pypi.org one pending publisher per distribution: the project name, owner `jubasse`, repository `seampact`, workflow `release.yml` and its environment.

  | Project | Environment |
  | --- | --- |
  | `seampact-ir` | `pypi-seampact-ir` |
  | `seampact-compiler` | `pypi-seampact-compiler` |
  | `seampact-hooks` | `pypi-seampact-hooks` |
  | `seampact-codegen` | `pypi-seampact-codegen` |
  | `seampact-signed-webhooks` | `pypi-seampact-signed-webhooks` |
  | `seampact-django` | `pypi-seampact-django` |
  | `seampact-fastapi` | `pypi-seampact-fastapi` |
  | `seampact-drf` | `pypi-seampact-drf` |
  | `seampact-ninja` | `pypi-seampact-ninja` |

- Each PHP package goes to its mirror `jubasse/seampact-<name>`: its split pushed to `main`, and the tag `v<version>` on one commit that adds the repository's `LICENSE` and, for seampact/ir, the release's `resources/binaries.json`. The push uses `PHP_MIRRORS_TOKEN`, scoped to the six mirrors, and Packagist follows the tags. Each package's `.gitattributes` leaves its tests and dev configs out of the Composer dist archive. A dry run pushes to local bare repositories, and Composer installs each package alone from them; seampact/ir's installed pins must be the ones `SHA256SUMS` gives. A mirror already tagged at the release tree is skipped; a tag at another tree fails by name.
- The conformance gate blocks the release: on a manual release run, `release.yml` starts every workflow `node scripts/checklist/cli.ts gate-workflows` lists at the release commit (`scripts/release/run-gate-workflows.sh`), then reads those runs; a checklist gap or a consumer without a report fails the run before anything is published. `node scripts/checklist/cli.ts` also checks the proofs under `docs/conformance/proofs/` against `docs/conformance/checklist.yaml`.
- Once the six PHP mirrors are on Packagist, start `post-release.yml` by hand with the published version. It installs that version from the real registries only (NestJS from npm, Spring Boot with Gradle and Maven, Laravel from Packagist, FastAPI from PyPI) and runs the http suite's default profile from the tag's checkout. It publishes nothing and reads no secret.
- A failed job can be rerun alone: a version already published with the same files is skipped. A full rerun packs again; if it packs other bytes than a version already published, it fails by name and publishes nothing. Fix it with a new patch version. If Central fails the upload while an earlier deployment of the version is still publishing, wait for that deployment on central.sonatype.com, then rerun. A gate workflow that fails on a registry error is rerun once automatically, and `publish-npm` stops at npm's new-package limit with a hint to rerun later.

## CI

- Each lane has its own workflow. A job first checks what the pull request changed; jobs it does not touch are skipped in seconds. The lane's last job is its required check.
- CI runs in two tiers. A pull request to `develop` gets the fast tier: `ci`, `checklist`, and for each lane the change really touches, its unit jobs on one version and one consumer per family (Express, React, FastAPI, Laravel, Spring Boot) on Linux. The other members of a family run on a pull request only when their own code changes.
- The push to `develop` after the merge runs the full tier: the fast rows, the queue rows (jobs named `-queue`: Windows, floor versions, the other consumers, the five-platform binaries), the `release` dry run, and the post-merge rows (slow rows that rarely break). A queue job skipped on a pull request passes its required check. (No merge queue exists, so these rows run on the push, after the merge; a failure there is fixed forward.) Each push to `develop` runs in its own concurrency group: a newer push never replaces a pending one, whose diff no other run would test. To run the full tier before review, use "Run workflow" on your branch.
- Drift rows run every night against the latest releases, and the nightly also runs every row of every lane. When a run on `develop` fails, `ci-watch` opens an issue, and the next pull request fixes it forward. A failed nightly is first rerun once, so a registry outage does not open one.
- Every workflow that reports a required check also runs `on: merge_group`, inert today and ready if the repository moves to an organization with a merge queue; a merge group would run the full tier. `scripts/ci/merge-queue.test.ts` holds the list of required checks and fails when one is missing.
- `checklist` lints every workflow with actionlint.
- A new workflow reuses the shared actions in `.github/actions/`: `lane-changes` and `lane-aggregate` for the change filter and the required check, `compiler-binary` for the compiler binary, `gradle-retry`, `composer-cache` and `maven-cache` for downloads.
- Caches are saved by pushes to `develop`, the nightly and manual runs; pull requests and merge groups only read them. The repository has a 10 GB cache limit, and an entry a pull request saved would serve only that pull request. To refresh the caches without waiting for the night, run the workflow by hand on `develop`.
- Coverage: the pull request row of each language's unit job measures coverage per package (vitest in `ci`, JaCoCo, pytest-cov, PHPUnit with pcov) and fails when a package falls under its floor in `scripts/coverage-floors/floors.json`, naming the package, the metric, the value and the floor; the job uploads the summary as a `coverage-*` artifact. When coverage rises, raise the floor by hand to the new value minus 1 point, rounded down: the check prints each package's value (`node scripts/coverage-floors/check.ts --format <vitest|coverage-py|cobertura> --summary <file>`; JaCoCo's HTML report for the JVM). A floor never goes down without the reason in the pull request.

## Dependencies

- Dependabot opens one grouped pull request per ecosystem each week (GitHub Actions, npm, uv, Composer), minor and patch releases only. A new major of a framework changes what seampact supports, so it is done by hand.
- Security updates come as soon as an advisory is published. A floor row tests the oldest version seampact declares, so a security update that would move it above that floor is closed, and its alert dismissed as test-only. The FastAPI guide explains this choice for Starlette, and [Supported versions](docs/supported-versions.md) gives the whole policy.
- `npm audit` runs nightly and on lockfile changes; Python runs `pip-audit` and PHP `composer audit`. An advisory that cannot be fixed here goes under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, with a comment saying why.
