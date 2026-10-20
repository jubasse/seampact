# 3. Generate the code

The config tells seampact where the contract is and what to generate. Create `seampact.config.yaml` in the app folder.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: validators
    use: "@seampact/codegen-zod"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-nestjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__` and `openapi/notes.yaml`. Commit them: `seampact check` fails later if they drift from the contract.

Every config key is in [configuration](configuration.md).

Not on NestJS? Each handlers page shows its own `server` target and dependencies.

Next: 4. Write the handlers for [NestJS](4-handlers-nestjs.md), [Express](4-handlers-express.md), [Fastify](4-handlers-fastify.md), [AdonisJS](4-handlers-adonis.md) or [Hono](4-handlers-hono.md)
