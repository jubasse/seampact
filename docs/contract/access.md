# Access

Every route says who may call it. A route with no answer is a compile error, so you cannot forget one.

## Open a route to everyone

`access: public` needs a reason. The reason is the point: it shows in review.

```yaml
surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
```

## Require a signed-in caller

Declare how a caller proves who they are (a scheme), name the caller (an identity), then put the identity on the surface.

```yaml
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

- `schemes` lists what a request carries: a bearer token, a cookie, an API key header.
- `principal` is the shape of the caller your handlers receive.
- A child route can still opt out with its own `access: { public: "<reason>" }`.

Seampact does not check the credential. It generates a hook, `authenticate`, and you write it.

## Require a right

A right is a question you answer in a hook: may this caller do this?

```yaml
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

`requires` is inherited. Put it on `member` to cover every route below.

## What is next

- Hooks you write: [NestJS](../backend/nestjs.md).
- Schemes, identities, rights, rules and scopes: [Access](../grammar/09-access-identities-rights-rules.md).
