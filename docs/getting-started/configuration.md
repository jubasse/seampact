# Configuration

`seampact.config.yaml` tells seampact where your contracts are, what to generate and what to check. Every section below is one task. Run the commands in the app folder.

## Where the config lives

Put `seampact.config.yaml` in the root of your app, next to `package.json`. Every path in it is relative to that file. The CLI reads it from the folder you run it in.

## Choose the generated folder

`outDir` is the one folder for all generated code. Without it, seampact writes to `__generated__` beside the config.

```yaml
outDir: src/__generated__
```

Each target writes to a subfolder named after its `id`. Set `out` on a target to rename it.

## Point to a contract

A source is a name and a place. A local folder:

```yaml
sources:
  notes:
    path: ./contract
```

A contract published by another team, pinned to a version. `integrity` is optional and starts with `sha256-`.

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

## Add a target

Each target generates one kind of code.

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
```

- `id` names the entry and its folder.
- `use` is the target's package.
- `apis` lists the contracts it covers (`api: notes` for one).
- `link` names the entries it builds on: `types: types`, `validators: validators`.
- `options` holds the target's own settings, for example `bodyValidation: true` on the NestJS server.

## Switch the validator

The server target reads its validators from the entry its `validators` link names. Change the package of that entry.

```yaml
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
```

`@seampact/codegen-zod`, `@seampact/codegen-yup` and `@seampact/codegen-class-validator` work with the NestJS server. Install the library you pick in your app (`yup`, or `class-validator` and `class-transformer`), then run `npx seampact generate`.

You see the `validators` folder rewritten. On NestJS, Express and Hono, a server without a `validators` link stops `generate` with `link.missing`, which names the packages to link.

Fastify and AdonisJS can skip it: leave out the `validators` entry and the link, and the server validates with the framework's own library, Ajv on Fastify and VineJS on AdonisJS. Install `ajv` or `@vinejs/vine` in your app.

## Write OpenAPI documents

`seampact generate` writes one document per api, `openapi/<api>.yaml` by default. Choose another place, and add servers:

```yaml
openapi:
  notes:
    path: docs/notes.openapi.yaml
    servers:
      - { url: "https://api.example.com", description: Production }
```

`openapi: none` writes no document.

## Choose what `check` does

`npx seampact check` regenerates in memory and compares with the files on disk. Set each check to `error` (fails, the default), `warning` (reports) or `disabled`.

```yaml
checks:
  generated: error
  openapi: warning
  matrix: warning
```

- `generated`: a generated file differs from the contract (`check.generated.drift`).
- `openapi`: an OpenAPI document differs (`check.openapi.drift`).
- `matrix`: a framework version seampact has not tested. It takes `error` or `warning`.

You see `check: the generated files and documents match the committed ones.` when nothing drifted.

## Serve Swagger on NestJS

`nativeDocs` makes the generated routes visible to `@nestjs/swagger`. `frameworkRoutes` lets the Swagger routes pass the boot check, which refuses routes outside the contract.

```sh
pnpm add @nestjs/swagger@12.0.2
```

Add both to the server target, then run `npx seampact generate`.

```yaml
    artefacts:
      nativeDocs: true
    frameworkRoutes:
      - { path: "/docs", reason: "Swagger UI." }
      - { path: "/docs/**", reason: "Swagger UI files." }
      - { path: "/docs-json", reason: "Swagger document." }
      - { path: "/docs-yaml", reason: "Swagger document." }
```

In `src/main.ts`, add the import and, before `app.listen`, these lines.

```ts
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

const config = NotesNest.withContractComponents({
  ...new DocumentBuilder().setTitle("Notes").setVersion("1").build(),
  openapi: "3.1.0",
});

const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false });

NotesNest.assertContractComponents(document);
SwaggerModule.setup("docs", app, document);
```

`assertContractComponents` stops the app if one of your classes has the same name as a contract schema, instead of letting it replace the schema in the document.

You see the Swagger page at `localhost:3000/docs`. Without the `frameworkRoutes` entries, the app stops at boot with `the framework route 'GET /docs/swagger-ui-init.js' is outside the contract and not allow-listed`.

## Share one config across apps

In a monorepo, a `seampact.config.yaml` at the root lists the apps. Each app keeps its own config.

```yaml
apps: [notes-app]
openapi:
  all:
    path: openapi/all.yaml
checks:
  openapi: error
```

Run `seampact generate` and `seampact check` from the root: they run every app, then write the merged document `all`.

Back to the [guide](README.md).
