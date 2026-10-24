# Boot errors

The generated server checks itself when the app starts. A problem stops the start with a message like this.

```text
seampact: the api 'notes' cannot start:
- operation 'getNote': handlers.NotesEndpoints has no method getNote(); fix: implement getNote() on the NotesEndpoints object.
```

Fix every line, then start again.

| You see | Do |
|---|---|
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | List the route under `frameworkRoutes` of the server target, with a reason, then run `seampact generate`. See [OpenAPI and docs](../configuration/openapi-and-docs.md). |
| `handlers has no 'NotesEndpoints' object` | Pass one object per generated handler interface. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method on that object. |
| `'bodyValidation' is turned on, but the target generated no output validators` | Set `bodyValidation: true` in the target's `options`, then run `generate`. |
| `no authenticate hook for the identity 'user'` | Register `authenticate.user` in your hooks. |
| `no decider for '<name>'` | Register a decider whose `names` lists it, or one with `names: all`. |
| `no scope resolver for the scope '<scope>'` | Register `scopeResolvers.<scope>`. |
| `no idempotency store for an idempotent operation` | Register `idempotencyStore`, for example `createMemoryIdempotencyStore()` of `@seampact/idempotency-memory`. |
| `two deciders claim '<name>'` | Keep the name in one decider. |
| `the seampact guard is not the last guard of <method>()` | Do not register a guard after the contract decorator on that route. |
| `<method>() has no input parameter, so its input is never validated` | Add `@<Op>.input() input`. |
| `the app interceptor <name> can answer <route> from its cache` | Keep cache interceptors off contract routes. The contract's `cache` sets the reply headers. |
| `<decorator> on <method>() writes after the boundary's reply`, `a @Res(), @Response() or @Next() parameter ...` | Remove it: return the reply instead. |
| `the api '<id>' is registered twice` | Import `SeampactModule.forRoot` once per api. |
| `the NestJS platform is '<x>'` | Use `@nestjs/platform-express`. |
| `'<key>' is not an option of SeampactModule.forRoot` | `forRoot` takes `{ logger }`. |

Two checks only warn, and the app still starts: global interceptors that run outside the reply interceptor, and request-scoped interceptors that cannot be checked at boot.
