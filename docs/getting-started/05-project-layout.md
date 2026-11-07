# Project layout

What [Your first API](your-first-api.md) leaves in your app folder.

```text
notes-app/
  seampact.config.yaml     what to generate and check
  contract/api.yaml        your contract
  openapi/notes.yaml       generated OpenAPI document
  <generated folder>/      generated code, never edit
  <your code>              your handlers and your app
```

- Edit `contract/`, `seampact.config.yaml` and your own files.
- The generated folder is the `outDir` of the config. Whether you commit it depends on the stack: see [Generated files](../configuration/config-file.md#generated-files). `seampact check` compares a committed folder and `openapi/` with the contract.
- Add the `baseline` folder (from [diff](../features/diff.md)) to `.gitignore`.

<details>
<summary>Node: NestJS, Express, Fastify, Hono, AdonisJS</summary>

```text
notes-app/
  src/
    __generated__/         generated code: types/ validators/ server/
    notes-controller.ts    your handlers
    main.ts                your app
```

Commit `src/__generated__` and `openapi/`.

</details>

<details>
<summary>Java: Spring Boot</summary>

```text
notes-app/
  build/generated/sources/seampact/main/   generated code (Maven: target/generated-sources/seampact)
  src/main/java/...                        your controllers
```

The build writes the generated folder: do not commit it.

</details>

<details>
<summary>PHP: Laravel, Symfony</summary>

```text
notes-app/
  app/Generated/       Laravel (Symfony: src/Generated)
  app/Http/...         your controllers
```

Commit the generated folder and `openapi/`.

</details>

<details>
<summary>Python: FastAPI, Django REST Framework, Django Ninja</summary>

```text
notes-app/
  generated/notes/     generated code
  main.py              your app (Django: your project files)
```

Commit `generated/` and `openapi/`.

</details>

## Repository layouts

Layouts mix freely, and each app picks its own stack.

- **One monorepo** with services, frontends and contracts: a root config lists the apps, each reads its contract as a `path` source. See [monorepo](../configuration/monorepo.md).
- **Services in a monorepo, frontends apart:** the monorepo publishes bundles; each frontend repository pins one with a `package`, `git` or `release` source.
- **One repository per app:** the contracts live in a contract repository that publishes bundles, and each app pins the ones it uses. See [sharing contracts](../features/sharing-contracts.md).
- **A shared core contract:** pin it as a bundle (npm package, git tag, release URL, or Maven for the JVM plugins), or add it as a git submodule read as a `path` source. A `path` may point anywhere, inside the repository or not; it is a local source, so `allowLocal: false` refuses it.

Next: [work with an AI agent](06-ai-agents.md), or [write more of the contract](../contract/README.md).
