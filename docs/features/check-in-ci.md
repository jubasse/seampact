# Check in CI

Use `seampact check` in CI to fail the build when the generated code or an OpenAPI document no longer matches the contract. Run the commands in the app folder. Each stack types them differently: see [commands per stack](commands-per-stack.md). The lines below use `npx` for Node.

## Try it locally

Change the contract (see [diff](diff.md)), then check the generated code.

```sh
npx seampact check
```

You see `check.generated.drift`. `check` exits with 1 on drift. Run `npx seampact generate` to fix it. When nothing drifted you see `check: the generated files and documents match the committed ones.`

`check` compares a generated folder you commit. On Spring Boot the build writes the files and nobody commits them: see [Generated files](../configuration/config-file.md#generated-files).

## Run it in GitHub Actions

Every stack uses the same job: check out the code, install the tools, lint the contract, check the generated files, and run your own tests. Only the install and run lines change. Open your stack.

<details>
<summary>Node</summary>

```yaml
# .github/workflows/seampact.yml
name: seampact
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx seampact lint
      - run: npx seampact check
      - run: npm test
```

</details>

<details>
<summary>Java: Gradle or Maven</summary>

`seampactCheck` runs in `./gradlew check`, and the Maven plugin runs `check` in `verify`, so the build is the check. Lint with the [compiler binary](../getting-started/install-other-ecosystems.md#the-compiler-binary).

```yaml
# .github/workflows/seampact.yml
name: seampact
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - run: |
          curl -fsSLo seampact https://github.com/jubasse/seampact/releases/latest/download/seampact-linux-x64
          chmod +x seampact
      - run: ./seampact lint
      - run: ./gradlew check             # Maven: ./mvnw verify
```

</details>

<details>
<summary>PHP: Laravel, Symfony</summary>

```yaml
# .github/workflows/seampact.yml
name: seampact
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: "8.3" }
      - run: composer install --no-interaction
      - run: |
          curl -fsSLo seampact https://github.com/jubasse/seampact/releases/latest/download/seampact-linux-x64
          chmod +x seampact
      - run: ./seampact lint
      - run: vendor/bin/seampact check
      - run: vendor/bin/phpunit          # your own tests
```

</details>

<details>
<summary>Python: FastAPI, Django REST Framework, Django Ninja</summary>

```yaml
# .github/workflows/seampact.yml
name: seampact
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync
      - run: |
          curl -fsSLo seampact https://github.com/jubasse/seampact/releases/latest/download/seampact-linux-x64
          chmod +x seampact
      - run: ./seampact lint
      - run: uv run seampact check       # Django: uv run python manage.py seampact_check
      - run: uv run pytest               # your own tests
```

</details>

The `lint` step of the other stacks downloads the [compiler binary](../getting-started/install-other-ecosystems.md#the-compiler-binary) from the releases page. To also fail on a breaking contract change, add a step with `seampact diff --against <baseline>`: see [Diff](diff.md).

## Set the levels

Set each check to `error` (fails), `warning` (reports) or `disabled`. Put them under `checks` in `seampact.config.yaml`.

```yaml
checks:
  generated: error
  openapi: error
  matrix: warning
```

- `generated` (default `error`): a generated file differs from the contract (`check.generated.drift`).
- `openapi` (default `error`): an OpenAPI document differs (`check.openapi.drift`).
- `matrix` (default `warning`, takes `error` or `warning`, not `disabled`): a framework version seampact has not tested. For the React target it also checks React 19 and the query library the `query` option picks: TanStack Query 5, SWR 2, or Redux Toolkit 2 with React Redux 9.

Every key: [Config reference](../configuration/reference.md#checks).

## Next

[Add seampact to an existing app](../getting-started/04-existing-project.md), or [write more of the contract](../contract/README.md).
