<!-- Generated from docs/backend/fastapi.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# FastAPI

Page: https://jubasse.github.io/seampact/backend/fastapi/

## Write a handler

Write one class per resource. It implements the generated `<Resource>Endpoints` protocol. A factory builds it, and the factory is a FastAPI dependency, so it takes your own dependencies:

```python
from fastapi import Depends
from generated.notes.operations import GetNoteErrors, GetNoteRequest, GetNoteResponse200, GetNoteResult


class NotesEndpoints:
    def __init__(self, notes: NoteRepository) -> None:
        self.notes = notes

    async def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        note = await self.notes.get(request.input.path.note_id)

        if note is None:
            return GetNoteErrors.api_not_found()

        return GetNoteResponse200(note)


def notes_endpoints(notes: NoteRepository = Depends(get_notes)) -> NotesEndpoints:
    return NotesEndpoints(notes)
```

- A method is a plain `def` or an `async def`. A `def` runs in FastAPI's thread pool (40 threads by default, shared with your other `def` dependencies).
- `request.input` holds the checked path, query, headers and body, typed. The input is checked before your factory runs, so no session opens for a bad request.
- You never write a status or a content type. Return one arm of the result (`GetNoteResponse200`), or an error (`GetNoteErrors.api_not_found()`). You can raise the same error instead.
- A reply that breaks the contract answers 500. So does any other exception, and `on_unexpected_error` hears it.

When an operation takes a version, the boundary checks its format only. Compare it with the stored version yourself, and return the operation's conflict error when they differ:

```python
if request.input.body.expected_version != task.version:
    return UpdateTaskErrors.state_conflict()
```

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](https://jubasse.github.io/seampact/contract/07-advanced/#catch-lost-updates).

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetNoteErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
workspace = request.scopes.workspace.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

## Paging

A paged list reads `request.input.query.cursor` (`None` when absent) and `request.input.query.limit` for the `cursor` style. The boundary fills in `defaultLimit` and answers 400 to a limit above `maxLimit` (`overLimit: clamp` serves `maxLimit`). `query.limit` stays typed `int | None`: narrow it with `assert query.limit is not None`.

Return the generated `<Operation>Page`: `items`, plus one snake-case attribute per page fact (`next_cursor` for `nextCursor`). The boundary writes the body, the headers and the `Link` relations.

```python
async def list_notes(self, request: ListNotesRequest) -> ListNotesResult:
    query = request.input.query
    notes, next_cursor = await self.notes.page(after=query.cursor, limit=query.limit)

    return ListNotesResponse200(body=ListNotesPage(items=notes, next_cursor=next_cursor))
```

Import `ListNotesPage` from `generated.notes.operations` with the other generated names. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

`bind_notes()` is the one call your app makes. Make it last, after your own middleware and exception handlers.

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from generated.notes.fastapi import NotesHandlerFactories, bind_notes

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["https://app.example.com"])

bind_notes(
    app,
    handlers=NotesHandlerFactories(notes=notes_endpoints),
    authenticate={"user": user_hook},
    deciders={"notes.update": NotesDecider},
    scope_resolvers={"workspace": WorkspaceResolver},
    on_unexpected_error=NotesErrors,
)
```

- It adds the contract's routes, the exception handlers and the boundary. The boundary is the outermost middleware of the app.
- `handlers` has one factory per resource. `authenticate` has one hook factory per identity, `deciders` one per right or rule, `scope_resolvers` one per scope. Keys are the contract's names.
- Add `CORSMiddleware` before `bind_notes()`. A preflight request passes the boundary and reaches it.
- With two apis, call `bind_<api>()` twice.
- To use an `APIRouter`, pass it as the first argument and add `app=app`. Call `bind_notes()` before `app.include_router(router)`. A prefix on that router is refused: use `mount` on the entry.

Each route is named `seampact.<api>.<operationId>`, and its parameters take the input property names. `NotesRouteNames` holds the names and `NotesUrls` builds the paths. `artefacts: { routeHelpers: false }` leaves both out.
