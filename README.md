# seampact

**Declare your API once in YAML. Get typed handlers, validators, OpenAPI and clients for your own framework.**

[![CI](https://img.shields.io/github/actions/workflow/status/jubasse/seampact/ci.yml?branch=develop&label=CI)](https://github.com/jubasse/seampact/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933.svg)](docs/getting-started/01-install.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?logo=typescript&logoColor=white)](docs/concepts/packages.md)
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

One contract. The handler in your framework:

<details open><summary>NestJS</summary>

```ts
@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  }
}
```

</details>

<details><summary>Express</summary>

```ts
export const notesHandlers: NotesExpress.NotesEndpoints = {
  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },
};
```

</details>

<details><summary>Fastify</summary>

```ts
export const notesHandlers: NotesFastify.NotesEndpoints = {
  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },
};
```

</details>

<details><summary>AdonisJS</summary>

```ts
export default class NotesController implements NotesAdonis.NotesEndpoints {
  getNote(input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId)

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }

    return { status: Notes.Status.Ok, body: note }
  }
}
```

</details>

<details><summary>Hono</summary>

```ts
export const notesEndpoints: NotesHono.NotesEndpoints = {
  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },
};
```

</details>

The validators, from the same `Note` schema. Pick one per app:

<details open><summary>zod</summary>

```ts
export const NoteSchema = z.object({
  noteId: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      { error: "Expected a UUID: 8-4-4-4-12 hex digits." },
    ),
  title: z
    .string()
    .refine((value) => codePointLength(value) >= 1, {
      error: "Expected at least 1 character.",
      params: { rule: "minLength" },
    })
    .refine((value) => codePointLength(value) <= 100, {
      error: "Expected at most 100 characters.",
      params: { rule: "maxLength" },
    }),
  createdAt: z
    .string()
    .refine(isDateTime, {
      error: "Expected an RFC 3339 date-time with a time offset.",
      params: { rule: "format" },
    }),
});
```

</details>

<details><summary>yup</summary>

```ts
export const NoteSchema = yup
  .object({
    noteId: yup
      .string()
      .strict()
      .test({
        name: "format",
        message: "Expected a UUID: 8-4-4-4-12 hex digits.",
        test: (value) =>
          value === undefined ||
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            value,
          ),
      })
      .defined(),
    title: yup
      .string()
      .strict()
      .test({
        name: "minLength",
        message: "Expected at least 1 character.",
        test: (value) => value === undefined || codePointLength(value) >= 1,
      })
      .test({
        name: "maxLength",
        message: "Expected at most 100 characters.",
        test: (value) => value === undefined || codePointLength(value) <= 100,
      })
      .defined(),
    createdAt: yup
      .string()
      .strict()
      .test({
        name: "format",
        message: "Expected an RFC 3339 date-time with a time offset.",
        test: (value) => value === undefined || isDateTime(value),
      })
      .defined(),
  })
  .noUnknown()
  .default(undefined);
```

</details>

<details><summary>class-validator (NestJS)</summary>

```ts
export class NoteDto {
  @IsString()
  @contract.Format("uuid", "Expected a UUID: 8-4-4-4-12 hex digits.")
  noteId!: string;

  @IsString()
  @contract.MinLength(1, "Expected at least 1 character.")
  @contract.MaxLength(100, "Expected at most 100 characters.")
  title!: string;

  @IsString()
  @contract.Format(
    "date-time",
    "Expected an RFC 3339 date-time with a time offset.",
  )
  createdAt!: string;
}
```

</details>

<details><summary>VineJS (AdonisJS)</summary>

The target builds the VineJS schema from this shape when the app starts.

```ts
export const NoteSchema = vineStandardSchema({
  kind: "object",
  unknownKeys: "strip",
  fields: [
    {
      key: "noteId",
      optional: false,
      type: {
        kind: "scalar",
        base: "string",
        checks: [
          {
            rule: "format",
            format: "uuid",
            message: "Expected a UUID: 8-4-4-4-12 hex digits.",
            layout:
              "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          },
        ],
      },
    },
    {
      key: "title",
      optional: false,
      type: {
        kind: "scalar",
        base: "string",
        checks: [
          {
            rule: "minLength",
            limit: 1,
            message: "Expected at least 1 character.",
          },
          {
            rule: "maxLength",
            limit: 100,
            message: "Expected at most 100 characters.",
          },
        ],
      },
    },
    {
      key: "createdAt",
      optional: false,
      type: {
        kind: "scalar",
        base: "string",
        checks: [
          {
            rule: "format",
            format: "date-time",
            message: "Expected an RFC 3339 date-time with a time offset.",
          },
        ],
      },
    },
  ],
});
```

</details>

<details><summary>Ajv JSON Schema (Fastify)</summary>

A plain JSON Schema; `seampactMessages` is the keyword that carries the contract's messages.

```ts
export const NoteSchema = ajvStandardSchema({
  type: "object",
  properties: {
    noteId: {
      type: "string",
      format: "uuid",
      seampactMessages: { format: "Expected a UUID: 8-4-4-4-12 hex digits." },
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      seampactMessages: {
        minLength: "Expected at least 1 character.",
        maxLength: "Expected at most 100 characters.",
      },
    },
    createdAt: {
      type: "string",
      format: "date-time",
      seampactMessages: {
        format: "Expected an RFC 3339 date-time with a time offset.",
      },
    },
  },
  required: ["noteId", "title", "createdAt"],
});
```

</details>

Planned: Spring Bean Validation for Spring Boot, validation rules for Laravel.

And the client:

<details open><summary>fetch</summary>

```ts
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const reply = await client.getNote({ path: { noteId } });

if (reply.ok) console.log(reply.body.title);
```

</details>

<details><summary>TanStack Query (React)</summary>

```tsx
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesHooks(client);

function NoteTitle(props: { noteId: string }) {
  const note = Notes.useGetNote({ path: { noteId: props.noteId } });

  if (note.isPending) return <p>Loading</p>;
  if (note.isError) return <p>{note.error.message}</p>;

  return <h1>{note.data.body.title}</h1>;
}
```

</details>

The full walk-through is in [Get started](docs/getting-started/README.md).

## Supported stacks

| Server | Versions | Validators |
|---|---|---|
| NestJS | 12 | zod, yup, class-validator |
| Express | 4, 5 | zod, yup |
| Fastify | 5 | zod, yup, Ajv |
| AdonisJS | 6, 7 | zod, yup, VineJS |
| Hono | 4 | zod, yup |

Clients: typed `fetch` client, and for React 19 over it TanStack Query 5 options and hooks, SWR 2 keys, fetchers and hooks, or an RTK Query 2 api. Vue and Angular: planned.

Java (Spring Boot 4) and PHP (Laravel, Symfony): planned.

## Get started

- [Getting started](docs/getting-started/README.md): a notes API on NestJS, in four steps.
- [Configuration](docs/configuration/config-file.md): every key of `seampact.config.yaml`.
- [Troubleshooting](docs/troubleshooting/README.md).

## Status

Pre-1.0. The reference contract runs end to end on every server above. Nothing is published to npm yet: install from a checkout, as Get started shows. See the [roadmap](docs/roadmap.md).

## More docs

Every page is listed in [docs/README.md](docs/README.md).

## Roadmap

- [x] Node servers: NestJS, Express, Fastify, AdonisJS, Hono
- [x] CLI: `generate`, `check`, `lint`, `diff`, `bundle`, `explain`, editor schemas (`compile --editor-schemas`)
- [ ] Frontend: React hooks (TanStack Query done; SWR and RTK Query next), Vue, Angular, MSW mocks
- [ ] Java: Spring Boot. PHP: Laravel, Symfony, API Platform
- [ ] Standalone binary (built for five platforms; release downloads next), docs site, 1.0 on npm
- Later: Next.js, Bun, Deno, Workers, Kotlin, Swift, Dart, Python, Go, .NET, Rust ([full list](docs/roadmap.md))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
