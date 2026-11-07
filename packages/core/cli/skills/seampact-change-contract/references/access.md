<!-- Generated from docs/contract/04-access.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Access

Page: https://jubasse.github.io/seampact/contract/04-access/

Use this page to say who may call each route. Every route says who may call it. A route with no answer is a compile error, so you cannot forget one.

## Open a route to everyone

`access: public` needs a reason. The reason is the point: it shows in review.

```yaml
# contract/api.yaml, top level
surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
```

## Require a signed-in caller

Declare how a caller proves who they are (a scheme), name the caller (an identity), then put the identity on the surface.

```yaml
# contract/api.yaml, top level (this surface replaces the one above)
schemes:
  bearer: { kind: bearer }

identities:
  user:
    schemes: { read: [bearer], write: [bearer] }
    principal: UserPrincipal

schemas:
  UserId: { type: string, format: uuid }
  UserPrincipal:
    type: object
    required: [userId]
    properties: { userId: UserId }

surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes: {}
```

- `schemes` lists what a request carries: a bearer token, a cookie, an API key header. `read` and `write` name the schemes accepted for reads and for writes.
- `principal` is the shape of the caller your handlers receive.
- A child route can still opt out with its own `access: { public: "<reason>" }`.

seampact does not check the credential. A [hook](https://jubasse.github.io/seampact/concepts/glossary/) is code you write and seampact calls. It generates one named `authenticate`: you check the token there and return the caller. The hook is an object in Node, an interface in Spring Boot, a class in Laravel and Symfony, and a function in Python: see the guides under Next.

## Require a right

A right is a question you answer in a hook: may this caller do this? Continue the contract above and add these keys:

```yaml
# contract/api.yaml, top-level `rights`, and routes under `surfaces.app.routes`
rights:
  notes.update:
    subject: { resource: Note, id: NoteId }

surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          update:
            input: UpdateNote
            requires: [{ right: notes.update }]
```

`subject` says what the right is about. Here it is the note named by `noteId` in the path. The generated `decide` hook receives the right, the caller and the note id. You answer yes or no. A `no` becomes a `403` in the contract's error format.

`requires` flows down the tree. Put it on `member` to cover every route below (see [Settings flow down the tree](https://jubasse.github.io/seampact/contract/01-basics/#settings-flow-down-the-tree)).

## Next

- Next: [Lists](https://jubasse.github.io/seampact/contract/05-lists/).
- Write the hooks: [Node servers](https://jubasse.github.io/seampact/backend/node-hooks/), [Spring Boot](https://jubasse.github.io/seampact/backend/spring-boot/#write-the-hooks), [Symfony](https://jubasse.github.io/seampact/backend/symfony/#write-the-hooks), [Laravel](https://jubasse.github.io/seampact/backend/laravel/#write-the-hooks), [FastAPI](https://jubasse.github.io/seampact/backend/fastapi/#write-the-hooks), [Django REST Framework](https://jubasse.github.io/seampact/backend/drf/#write-the-hooks), [Django Ninja](https://jubasse.github.io/seampact/backend/ninja/#write-the-hooks).
- In depth: [Access](https://jubasse.github.io/seampact/grammar/09-access-identities-rights-rules/).
