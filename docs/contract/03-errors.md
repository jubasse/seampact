# Errors

An error is a code with a status. The contract lists which codes a route can answer. The generated handler can return only those.

## Declare a code

```yaml
errors:
  notes.locked:
    status: 423
    title: Another editor holds the note.
    params: { lockedBy: { type: string } }
    example: { lockedBy: ada }
```

- `status` is from 400 to 599.
- `title` is a short text for people. It is optional: a code without one sends no `title` member.
- `params` is the extra data in the error body. It is optional.
- `nature` tells a client whether a retry can help: `refused` (no), `unavailable` (maybe later) or `failed` (the server broke). It defaults from the status, so you rarely write it.

## Attach it to routes

Put `errors` on the node. Every route below it can answer the code.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  errors:
    notes.locked: {}
  ops: [get]
```

`{}` attaches a code declared elsewhere. You can also declare the code right there, with its `status`.

## The codes you get for free

Seampact adds the codes the boundary needs: `api.not_found`, `api.schema_invalid`, `api.forbidden` and the others. You do not declare them, and they have no `title`. Handlers return them by name, for example `Notes.ErrorCode.ApiNotFound`.

## Use your own code for a built-in case

A built-in case is a role, such as `notFound`. Bind the role to your code, for the whole api or for a subtree.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  errors:
    notes.not_found: { status: 404, title: No such note. }
  member:
    errorRoles:
      notFound: notes.not_found
    routes: {}
  ops: [get]
```

The role `notFound` is now answered with `notes.not_found` below `member`.

A 404 code you declare without this binding sits beside the built-in one, so the route has two 404 codes: the lint rule `seampact/not-found-role` warns and proposes the `errorRoles` line.

## Return an error from a handler

The handler returns the status and the code. The generated types reject any other.

```ts
return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };
```

## What is next

- The error format on the wire is a convention: [Conventions](../grammar/13-conventions-and-wire-formats.md).
- Every error key, reach and roles: [Errors and natures](../grammar/11-errors-and-natures.md).
