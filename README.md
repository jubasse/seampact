# seampact

**Declare your API once in YAML. Get typed handlers, validators, OpenAPI and clients for your own framework.**

[![CI](https://img.shields.io/github/actions/workflow/status/jubasse/seampact/ci.yml?branch=develop&label=CI)](https://github.com/jubasse/seampact/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933.svg)](docs/getting-started/1-install.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?logo=typescript&logoColor=white)](docs/packages.md)
![Status: pre-1.0, not on npm yet](https://img.shields.io/badge/status-pre--1.0%2C%20not%20on%20npm%20yet-orange.svg)

## Why seampact

- **One contract, no drift.** Types, validators, OpenAPI and clients all come from the same YAML.
- **Code you can read.** The output uses your framework's own mechanisms, in one `__generated__` folder.
- **Checked before your handler runs.** Input is validated and errors answer in one `problem+json` format.
- **Access at the boundary.** Every route states who may call it, and the app refuses to start without a hook for it.
- **Safe changes.** `seampact check` and `seampact diff` catch drift and breaking changes in CI.
- **Your tools keep working.** Swagger, Ajv and VineJS stay in place.

## Example

The contract:

```yaml
schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      createdAt: { type: string, format: date-time }

surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops: { get: {} }
```

Your NestJS handler, typed from it:

```ts
@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined) return { status: 404 as const, code: "api.not_found" as const };

    return { status: 200 as const, body: note };
  }
}
```

The full walk-through is in [Get started](docs/getting-started/README.md).

## Supported stacks

| Server | Versions | Validators |
|---|---|---|
| NestJS | 12 | zod, yup, class-validator |
| Express | 4, 5 | zod, yup |
| Fastify | 5 | zod, yup, Ajv |
| AdonisJS | 6, 7 | zod, yup, VineJS |
| Hono | 4 | zod, yup |

Clients: typed `fetch` client. Hooks for the frontends (React, Vue, Angular): planned.

Java and PHP: planned.

## Get started

- [Getting started](docs/getting-started/README.md): a notes API on NestJS, in six steps.
- [Configuration](docs/getting-started/configuration.md): every key of `seampact.config.yaml`.
- [Troubleshooting](docs/getting-started/troubleshooting.md).

## Status

Pre-1.0. The reference contract runs end to end on every server above. Nothing is published to npm yet: install from a checkout, as Get started shows. See the [roadmap](docs/roadmap.md).

## More docs

- [What seampact generates, and what it leaves to you](docs/overview.md)
- [Package map](docs/packages.md)
- [Which generators combine](docs/combining-generators.md)
- [Setting up a server target](docs/server-targets.md)
- [Mobile and Capacitor](docs/mobile-and-capacitor.md)
- [Sharing a contract between repositories](docs/sharing-a-contract.md)
- [What seampact does not do](docs/scope.md)
- [Roadmap after 1.0](docs/roadmap.md)
- [Design decisions](docs/design-decisions.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
