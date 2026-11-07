<!-- Generated from docs/backend/laravel.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Laravel

Page: https://jubasse.github.io/seampact/backend/laravel/

## Write a handler

Each resource has a generated `<Resource>Endpoints` interface. Each method takes the operation's `FormRequest`, which sits in the root namespace (`App\Generated\Notes\GetNoteRequest`) beside its result and errors, and returns one arm of its result: `GetNoteResponse200` and the like, or an error of `GetNoteErrors`. Bind the interface to your controller in a service provider.

```php
final class NotesController implements NotesEndpoints
{
    public function getNote(GetNoteRequest $request): GetNoteResult
    {
        $note = $this->notes->get($request->contractInput()->path->noteId);

        return $note === null
            ? GetNoteErrors::apiNotFound()
            : new GetNoteResponse200($note);
    }
}
```

```php
$this->app->bind(NotesEndpoints::class, NotesController::class);
```

`contractInput()` returns the checked path, query, headers and body, typed. You never write a status or a content type. A reply that breaks the contract answers 500; so does `response()->json()` from a handler.

A handler may also throw the generated exception of a declared error. `findOrFail()`, `firstOrFail()` and `abort(404)` answer the operation's `notFound` error.

When an operation takes a version, the boundary checks its format only. Compare it with the stored version yourself, and return the operation's conflict error when they differ:

```php
if ($request->contractInput()->body->expectedVersion !== $task->version) {
    return UpdateTaskErrors::stateConflict();
}
```

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](https://jubasse.github.io/seampact/contract/07-advanced/#catch-lost-updates).

A deadline is a declared header, so read it from the checked input headers. Once the deadline has passed, stop the work and answer the operation's `deadlineExceeded` error. `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `principal()` returns the caller in the generated `<Identity>Principal` class. It is `null` for an anonymous caller on an optional-auth route. A public route has no `principal()`.

When the route runs in scopes, `scopes()` has one method per scope. Each returns what your scope resolver returned, with its `id` and its `value`. Load a record once in the resolver, then read it here:

```php
$workspace = $request->scopes()->workspace()->value;
$userId = $request->principal()->userId;
```

Neither is part of the input, and both come from this api's own boundary. `$request->user()` is Laravel's default guard, which the boundary does not set: read the caller from `principal()`.

### With Eloquent

The handler maps your model to the contract's type. Extra columns never leave the boundary: the reply holds only the contract's fields.

```php
return new GetNoteResponse200(new Note($row->id, $row->title, $row->created_at->toDateTimeImmutable()));
```

The same holds for an API Resource: build the generated type from it.

## Paging

With `@seampact/pack-laravel`, a paged list answers Laravel's paginator, and the boundary writes `{ data, links, meta }` for you.

The boundary validates `page` and `per_page` first. Use the validated values from `contractInput()`. Laravel's own page resolver falls back to page 1 on a bad value, so do not rely on it.

```php
$query = $request->contractInput()->query;
$page = $query->page ?? 1;
$perPage = $query->perPage ?? 20;

$notes = Note::query()->paginate($perPage, ['*'], 'page', $page);

return new ListNotesResponse200(new LengthAwarePaginator($notes->items(), $notes->total(), $perPage, $page));
```

The page and the limit in the reply are the request's, never the paginator's own. Cursor paging answers a `CursorPaginator` the same way. Without the pack, a list returns the generated `<Operation>Page` class.
