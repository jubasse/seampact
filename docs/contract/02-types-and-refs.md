# Types and references

Every body, query field and id is a schema. Schemas live under `schemas` and are used by name.

## Write a schema

```yaml
schemas:
  NoteId: { type: string, format: uuid }
  Color: { enum: Palette }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000, nullable: true }
      tags: { type: array, items: { type: string }, maxItems: 10 }
      color: Color
      createdAt: { type: string, format: date-time }

enums:
  Palette: { values: [red, green, blue], reason: "Colors are local to this api." }
```

- Types are `string`, `integer`, `number`, `boolean`, `object` and `array`.
- A property is optional unless it is in `required`. In `query`, `headers` and `id`, a name ending with `?` is optional.
- `nullable: true` lets the value be `null`. Optional and nullable are two different things.
- `minLength` and `maxLength` count characters (Unicode code points), as JSON Schema does: `"😀"` is one character. Every generated validator and server counts the same way.
- A schema name starts with a capital letter. Use the name wherever a schema fits: `item: Note`, `input: CreateNote`, `noteId: NoteId`.
- An enum needs a `reason`. It says why the values are local.

## Refuse what you cannot trust

A schema holds only what every server and client library can check. `anyOf` and type arrays such as `[string, "null"]` are refused. Use `nullable`, or `oneOf` with a discriminator.

## Split a contract into files

Move schemas to their own file and include it.

```yaml
# api.yaml
schemas:
  $include: ./schemas.yaml
```

```yaml
# schemas.yaml
NoteId: { type: string, format: uuid }
Note:
  type: object
  required: [noteId]
  properties:
    noteId: NoteId
```

`$include` pastes the file in place. Paths are relative to the file that holds them and stay inside the workspace root (the folder of `workspace.yaml`, or of the api file when there is none).

Share one base between several apis with `extends`.

```yaml
extends: ./base.yaml
```

A name defined in both files is an error. Remove the copy.

## What is next

- Errors: [Errors](03-errors.md).
- The schema language: [ADR 0003](../adr/0003-schema-language.md). Files and references: [Composition](../grammar/02-composition-extends-packs-include.md).
