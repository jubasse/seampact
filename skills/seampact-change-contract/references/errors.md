<!-- Generated from docs/contract/03-errors.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Errors

Page: https://jubasse.github.io/seampact/contract/03-errors/

Use this page to say what a route can answer when it fails. An error is a code with a status. The contract lists which codes a route can answer. The generated handler can return only those.

## Declare a code

```yaml
# contract/api.yaml, top level
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
- `nature` tells a client whether to retry. It defaults from `status` ([Errors and natures](https://jubasse.github.io/seampact/grammar/11-errors-and-natures/)).

## Attach it to routes

Put `errors` on the node. Every route below it can answer the code (see [Settings flow down the tree](https://jubasse.github.io/seampact/contract/01-basics/#settings-flow-down-the-tree)).

```yaml
# contract/api.yaml, under surfaces.app.routes
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

seampact adds the codes the boundary needs: `api.not_found`, `api.schema_invalid`, `api.forbidden` and the others. You do not declare them, and they have no `title`. Handlers return them by name: `api.not_found` becomes `Notes.ErrorCode.ApiNotFound`.

## Use your own code for a built-in case

To answer a built-in case, such as not found, with your own code, bind its role (`notFound`) to your code with `errorRoles`. Do it for the whole api or for a subtree.

```yaml
# contract/api.yaml, under surfaces.app.routes
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

<details>
<summary>Spring Boot (Java)</summary>

```java
return new GetNoteErrors.ApiNotFound();
```

</details>

<details>
<summary>Laravel, Symfony and API Platform (PHP)</summary>

```php
return GetNoteErrors::apiNotFound();
```

</details>

<details>
<summary>FastAPI, Django REST framework and Django Ninja (Python)</summary>

```python
return GetNoteErrors.api_not_found()
```

</details>

A framework exception, such as a missing record, can map to a contract error too. The rule differs per framework: see "Write a handler" in your [server guide](https://jubasse.github.io/seampact/documentation/#server-guides).

## Next

- Next: [Access](https://jubasse.github.io/seampact/contract/04-access/).
- In depth: [Errors and natures](https://jubasse.github.io/seampact/grammar/11-errors-and-natures/). To change the error format, see [Conventions](https://jubasse.github.io/seampact/grammar/13-conventions-and-wire-formats/).
