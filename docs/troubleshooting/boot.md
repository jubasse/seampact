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

## Symfony

Same start check, run by `bin/console cache:warmup` and on the first request. The message starts with `seampact: the api 'tasks' cannot start:`, or with `the api 'tasks' cannot start:` for the hook lines.

| You see | Do |
|---|---|
| `no authenticate hook for the identity '<id>'` | Register one service implementing the generated `<Id>AuthenticateHook`, with autoconfiguration on. |
| `no decider for '<name>'` | Register a service implementing the api's `Decider` that names it, or `[Decider::EVERY_NAME]`. |
| `no scope resolver for the scope '<scope>'` | Register a service implementing the api's `ScopeResolver`. |
| `two deciders claim '<name>'` | Keep the name in one decider. |
| `no idempotency store for '<operation>'` | Alias `Seampact\Hooks\IdempotencyStore` to a service implementing it. |
| `operation '<id>' has no handler` | Register one controller service implementing the `<Resource>Endpoints` interface. |
| `the method <class>::<method> handles operation '<id>' but is not marked #[SeampactOperation('<id>')]` | Add the attribute. |
| `the controller <class> carries #[IsGranted]`, `... #[IsCsrfTokenValid]`, `... #[IsSignatureValid]` | Remove it. Use an `access_control` rule on `seampact.<api>.matcher.<kind>`, or a decider. |
| `framework.http_cache is on` | Turn it off: a reply HttpCache serves never reaches the boundary. |
| `the input resolver ... is not registered as a value resolver` | List the api's bundle in `config/bundles.php`. |
| `the service <id> listens to kernel.request at priority ...`, `... kernel.response at priority ...` | Move your listener inside the boundary's priorities, as the message says. |
| `the api writes absolute URLs ... and 'seampact_<api>.public_origin' is not set` | Set `public_origin` to the origin clients call, such as `https://api.example.com`: a scheme, a host, an optional port, no path. |
| `the PHP extension zlib is not loaded`, `Symfony <x> is not supported` | Enable ext-zlib. Use Symfony 7.4 or 8. |
| `the route of operation '<id>' has the path ...`, `... carries a host, a scheme or a condition` | Import the api's routes with no `prefix`, `host`, `schemes` or `condition`. |
| `an app route with the path ... is registered before the route of operation '<id>'` | Import the contract routes first. |
| `the api '<other>' registered before this one answers its catch-all 404` | Set `catchAll: false` on the api whose base path prefixes the other's. |
| `runtime.worker.unsupported` | Serve the app with php-fpm. Worker runtimes are refused. In a functional test, do not call `disableReboot()`. |
| `the app route '<name>' (<path>) is not a contract route and the entry's frameworkRoutes does not list it` | List the route under `frameworkRoutes` of the entry, with a reason, then run `generate`. |
| `operation '<id>' has no route`, `operation '<id>' has <n> routes` | Import the api's resource, type `seampact`, once in your routing configuration. |

An invalid `%env()%` value of the bundle configuration does not stop the start: the api answers 500 on its routes and the log names the key.
