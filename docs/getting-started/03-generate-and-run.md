# Generate the code and run it

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

Every config key is in [configuration](../configuration/config-file.md).

Not on NestJS? Each handlers page shows its own `server` target and dependencies.

## Write the handlers

Pick your server. Each page writes the handlers and shows the config to use.

- [NestJS](../backend/nestjs.md)
- [Express](../backend/express.md)
- [Fastify](../backend/fastify.md)
- [AdonisJS](../backend/adonisjs.md)
- [Hono](../backend/hono.md)

## Run it

Start the app from the app folder.

```sh
npx tsx src/main.ts
```

In another terminal, create a note.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":"Buy milk"}'
```

You see `201` and the note with its `noteId`. `curl localhost:3000/v1/notes` lists it.

Send an empty title.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":""}'
```

You see `400` and a `application/problem+json` body whose `issues` names `/title`.

AdonisJS: start the app with `node ace serve` instead.

Next: [diff a change](../features/diff.md).
