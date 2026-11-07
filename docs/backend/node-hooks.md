# Hooks for Node servers

A hook is a function you write and seampact calls. The contract says who may call a route and what they may do; hooks answer those questions with your users, your roles and your database. The five Node servers ([NestJS](nestjs.md), [Express](express.md), [Fastify](fastify.md), [Hono](hono.md) and [AdonisJS](adonisjs.md)) share the same hooks. Only the place where you register them differs.

A public api needs no hooks. Read [Access](../contract/04-access.md) first if you have not declared an identity yet.

## The hooks

| Hook | Key in the object | The contract needs it when | You return |
|---|---|---|---|
| authenticate | `authenticate.<identity>` | a route has an identity | the caller (`principal`), or a denial |
| decide | `deciders` | a route requires a right or a rule | allow, or a denial |
| scope resolver | `scopeResolvers.<scope>` | a route runs in a scope | the scope, or a denial |
| idempotency store | `idempotencyStore` | an operation is idempotent | (an object, see below) |
| unexpected-error listener | `onUnexpectedError` | never; it is optional | nothing |

A denial is `{ deny: { code, params } }`. The `code` must be one the contract declares for that identity, right or scope, and TypeScript checks it. seampact turns the denial into the contract's error reply.

## Write the hooks

The generated server exports a `SeampactHooks` type. Type your hooks with it, and the compiler tells you what is missing. Create `src/notes-hooks.ts`.

```ts
import { createMemoryIdempotencyStore } from "@seampact/idempotency-memory";
import type { SeampactHooks } from "./__generated__/server/notes/index.js";
import { findUserIdByToken, userMayUpdateNote } from "./accounts.js";

export function notesHooks(): SeampactHooks {
  return {
    authenticate: {
      user: {
        async authenticate(request) {
          const userId = await findUserIdByToken(request.credentials.bearer);

          if (userId === undefined) return { deny: { code: "api.unauthenticated" } };

          return { principal: { userId } };
        },
      },
    },

    deciders: [
      {
        names: "all",
        decider: {
          async decide(request) {
            if (request.name !== "notes.update") return { allow: true };

            const allowed = await userMayUpdateNote(request.principal, request.subject);

            return allowed ? { allow: true } : { deny: { code: "api.forbidden", params: {} } };
          },
        },
      },
    ],

    scopeResolvers: {},
    idempotencyStore: createMemoryIdempotencyStore(),

    onUnexpectedError(exceptionOrReply, context) {
      console.error(`unexpected failure in ${context.api}.${context.operation}`, exceptionOrReply);
    },
  };
}
```

`findUserIdByToken` and `userMayUpdateNote` are yours: they read your users and your notes. Each hook may return its answer or a promise of it.

What the example shows:

- `request.credentials` holds what the caller sent, one key per scheme of the identity. A `bearer` scheme gives the token without the `Bearer ` prefix. seampact calls the hook only when a credential is present; with none, the caller is refused before your code runs.
- `request.principal` is what `authenticate` returned, or `null` for an anonymous caller on a public or optional route.
- The hook object key is the identity name (`user`), the right or rule name (`notes.update`) or the scope name.
- A hook that throws is not a denial. The caller gets the api's 500 and `onUnexpectedError` receives the exception.

Register the object with the server, as each guide shows: [NestJS](nestjs.md#wire-it-in), [Express](express.md#wire-it-in), [Fastify](fastify.md#wire-it-in), [Hono](hono.md#wire-it-in) or [AdonisJS](adonisjs.md#wire-it-in).

### Authenticate

One per identity. It gets the credentials, and for a signed identity the raw body in `request.signature`. Return `{ principal }` or `{ deny }`. The principal has the shape the contract gives the identity, and your handlers receive it ([Who is calling](#who-is-calling-in-a-handler)).

### Decide

One decider answers every right and rule. Its request carries:

| Field | What it holds |
|---|---|
| `kind`, `name` | `right` or `rule`, and its name |
| `params` | the params written where the contract uses it |
| `principal` | the caller, or `null` |
| `subject` | what the right is about: `type`, `id`, and `record` when a loader is registered |
| `scopes` | the scopes resolved so far, outermost first |
| `purpose` | why it is asked: the route, one field, or one sort key |
| `bucket` | for a throttle rule, the count key, `limit` and `windowMs`; you keep the counter |
| `operation`, `request` | the operation (`api`, `id`) and the method, path, headers and client address |

To split the work, list names: `deciders: [{ names: ["notes.update"], decider: updateDecider }, { names: "all", decider: fallbackDecider }]`. A name goes to the decider that lists it, else to the `all` decider. Two deciders on one name, or two `all`, stop the boot.

### Scope resolver

One per scope kind, called outermost scope first. When the contract declares where the scope id comes from, `request.source` is `{ resolver: "declared", id }` and the id is already decoded and checked; otherwise it is `{ resolver: "custom", request }` and you read the request yourself. Return `{ resolved: { scope, id, value } }` or `{ deny }`. The optional `value` is yours (a loaded workspace, for instance); later hooks and the handler receive it as `unknown`.

```ts
scopeResolvers: {
  workspace: {
    async resolveScope(request) {
      if (request.source.resolver !== "declared") throw new Error("workspace ids come from the path");

      const workspace = await findWorkspace(request.source.id);

      if (workspace === undefined) return { deny: { code: "api.not_found" } };

      return { resolved: { scope: request.scope, id: request.source.id, value: workspace } };
    },
  },
},
```

### Idempotency store

Required when an operation is idempotent. `createMemoryIdempotencyStore()` keeps keys in the memory of one process and loses them on restart. Use it in development and tests. For production, write a store on shared storage (Redis, your database) with three methods:

| Method | When seampact calls it |
|---|---|
| `begin(claim)` | before the handler. Answer `{ outcome: "started" }`, `"running"` (the same key is still running: 409), `"mismatch"` (the key came with another request: 422) or `{ outcome: "replay", response }` |
| `complete(key, response)` | after the handler, to keep the reply for replays |
| `abandon(key)` | after a server error, so the client may retry |

The claim holds `key`, `fingerprint` and `lifetimeMs`; keep the key at least that long.

### Unexpected-error listener

`onUnexpectedError(exceptionOrReply, context)` runs when your code throws, or answers something the contract does not declare. `context` has `api`, `operation`, `method` and `path`. Send it to your logger or error tracker. If the listener itself throws, seampact logs that and goes on.

### Signed webhooks

A route signed by a sender (Stripe style) reaches `authenticate` with `request.signature`. Check it with `@seampact/signed-webhooks`, which holds no secret: you give it the secrets of a key id.

```ts
import { verifyTemplateSignature } from "@seampact/signed-webhooks";

if (request.signature?.verify !== "template") return { deny: { code: "api.unauthenticated" } };

const verification = await verifyTemplateSignature(request.signature, (keyId) => secretsOf(keyId));

return verification.verified ? { principal: { account: "acct_1" } } : { deny: { code: "api.unauthenticated" } };
```

The first line keeps only template-signed requests. A scheme with `verify: application` gives you `rawBody` and `signatureHeader` to check with your own library.

## Use your framework's own auth

Inside a decide hook, you can call your framework's guard and let it throw. A 401 or 403 it throws becomes the first denial code the right declares. Any other error is an unexpected error.

| Server | What counts as a denial |
|---|---|
| NestJS | `UnauthorizedException`, `ForbiddenException` |
| Express, Fastify, Hono | any error whose `status` or `statusCode` is 401 or 403 (`http-errors`, Fastify errors, Hono's `HTTPException`) |
| AdonisJS | `E_UNAUTHORIZED_ACCESS` and `E_AUTHORIZATION_FAILURE` (the auth guards and Bouncer) |

This works in `decide` only. In `authenticate` and in a scope resolver, return `{ deny }`.

## Who is calling in a handler

What `authenticate` returned reaches the handler as `principal`, and what the resolvers returned as `scopes`. Each guide shows where: the NestJS decorators, or the `input` of the other servers.

## Boot check

The server checks its hooks when it starts and refuses to start with a line that names the operation. Fix every line, then start again.

| Fault | Fix |
|---|---|
| `no authenticate hook for the identity '<id>'` | Add `authenticate.<id>`. |
| `no decider for '<name>'` | Add a decider whose `names` lists it, or one with `names: "all"`. |
| `no scope resolver for the scope '<scope>'` | Add `scopeResolvers.<scope>`. |
| `no idempotency store for an idempotent operation` | Add `idempotencyStore`. |
| `two deciders claim '<name>'` | Keep the name in one decider. |
| `two deciders claim every name ('all')` | Keep `all` on one decider. |

To let the server start with a hook missing, set `artefacts.bootCheck.hooks` to `warn` on the target entry: the server logs the lines, and the routes that lack a hook answer 500. `off` skips the check. See the [config reference](../configuration/reference.md#target-entries).

## Next

- [Access](../contract/04-access.md): identities, rights and scopes in the contract.
- [Boot errors](../troubleshooting/boot.md#node-servers): every start-up message of the Node servers.
