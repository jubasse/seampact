<!-- Generated from docs/backend/spring-boot.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Spring Boot

Page: https://jubasse.github.io/seampact/backend/spring-boot/

## Write a handler

Each resource has a generated `<Resource>Endpoints` interface, and each operation a mapping annotation in `<package>.spring`. Return one arm of the operation's result: `Status200` and the like, or an error of `<Operation>Errors`.

```java
@RestController
class NotesController implements NotesEndpoints {
    @Override
    @GetNote
    public GetNoteResult getNote(GetNoteInput input) {
        Note note = notes.get(input.path().noteId());

        return note == null
                ? new GetNoteErrors.ApiNotFound()
                : new GetNoteResult.Status200(note);
    }
}
```

The boundary has already checked the path, query, headers and body. You never write a status or a content type yourself.

A version in the input is checked for its format only. Compare it with the stored version, and return the operation's conflict error when they differ:

```java
if (input.body().expectedVersion() != task.version()) return new UpdateTaskErrors.StateConflict();
```

With `If-Match`, a missing or empty header (or `*`) answers 428 before the handler runs. A weak tag (`W/"7"`) is accepted. The handler gets the version unquoted (`7`) and returns the `preconditionFailed` error (412) on a mismatch. See [Catch lost updates](https://jubasse.github.io/seampact/contract/07-advanced/#catch-lost-updates).

### Who is calling

The input also tells you who calls and in which scopes:

- `input.principal()` is what your authenticate hook returned, typed as the identity's principal. It is null for an anonymous caller on an optional-auth route. A public route has no `principal()`.
- `input.scopes()` has one member per scope the operation runs in, each the `ResolvedScope` your resolver returned. An operation without scopes has no `scopes()`.

```java
UUID userId = input.principal().userId();
Object channelId = input.scopes().channel().id();
```

Neither comes from the request body: the client cannot set them.

## Paging

With `@seampact/pack-spring`, a list in the `springPage` style gets a `Pageable` in its input and returns Spring Data's `Page`. Add `org.springframework.data:spring-data-commons`; the Spring Boot BOM gives its version.

- A sort key reaches the `Pageable` as the item's Java member name: `sort=created_at,desc` sorts by `createdAt`. Name your entity's properties like the generated record's members.
- A page number past Spring Data's range (a page index above 2147483647) gets a 400 at the page parameter.
