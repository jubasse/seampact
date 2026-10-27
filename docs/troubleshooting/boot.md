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
| A route of yours outside the api's paths is no longer reported | That is the default: only routes that reach a path of the api are checked. Set `artefacts.bootCheck.frameworkRoutes: strict` to check every route. |
| `... differs from the entry's mount (write the prefix as the entry's 'mount' ...)` | Remove the prefix from the framework (route group, plugin prefix, `basePath`, mount path) and set `mount` on the target entry instead. |
| `runtime.generated-for-other-version` | The generated code was written by another seampact version than the installed runtime. Run `seampact generate` again, or install the runtime at the generator's version. On PHP, `seampact:generate` still runs under the skew. See [Generate errors](generate.md). |
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
| `@HttpCode on <method>() sets a status the boundary never writes` | Remove `@HttpCode`. Return the status from the handler. |
| `@Header on <method>() sets a header the boundary never writes` | Remove `@Header`. Declare the header in the contract's response. |
| `@Controller('<path>') on <Controller> prefixes the contract route` | Use `@Controller()` with no path. The contract's paths are absolute. |
| `RouterModule mounts <Module> under '<path>'` | Remove that `RouterModule` entry, or move the controller to a module it does not mount. |
| `setGlobalPrefix('<prefix>') prefixes <route>` | Exclude the contract routes with the `exclude` option of `setGlobalPrefix`, or remove the prefix. |
| `the api '<id>' is registered twice` | Import `SeampactModule.forRoot` or `forRootAsync` once per api. |
| `the NestJS platform is '<x>'` | Use `@nestjs/platform-express`. |
| `'<key>' is not an option of SeampactModule.forRoot` | `forRoot` takes `{ logger }`. |

Two checks only warn, and the app still starts: global interceptors that run outside the reply interceptor, and request-scoped interceptors that cannot be checked at boot.

## Symfony

Same start check, run by `bin/console cache:warmup` and on the first request. The message starts with `seampact: the api 'tasks' cannot start:`, or with `the api 'tasks' cannot start:` for the hook lines.

| You see | Do |
|---|---|
| `no authenticate hook for the identity '<id>'` | Register one service implementing the generated `<Id>AuthenticateHook`, with autoconfiguration on. At run time the same error reads `seampact: the api '<api>' has no authenticate hook for the identity '<id>'; ...`. |
| `no decider for '<name>'` | Register a service implementing the api's `Decider` that names it, or `[Decider::EVERY_NAME]`. |
| `no scope resolver for the scope '<scope>'` | Register a service implementing the api's `ScopeResolver`. |
| `two deciders claim '<name>'` | Keep the name in one decider. |
| `no idempotency store for '<operation>'` | Alias `seampact.<api key>.idempotency_store` to a service implementing `Seampact\Hooks\IdempotencyStore`. |
| `operation '<id>' has no handler` | Register one controller service implementing the `<Resource>Endpoints` interface. |
| `the method <class>::<method> handles operation '<id>' but is not marked #[SeampactOperation('<id>')]` | Add the attribute. |
| `the controller <class> carries #[IsGranted]` or `#[IsCsrfTokenValid]`, and the same with `the method <class>::<method> carries` | Remove it. Use an `access_control` rule on `seampact.<api>.matcher.<kind>`, or a decider. |
| `the controller <class> carries #[IsSignatureValid]`, or the method form | Remove it and use nothing instead: a signed URI is not a form the contract declares. |
| `framework.http_cache is on` | Turn it off: a reply HttpCache serves never reaches the boundary. |
| `the input resolver service ... is not registered as a value resolver` | List the api's bundle in `config/bundles.php`. |
| `the service <id> listens to kernel.request at priority ...`, `... kernel.response at priority ...` | Move your listener inside the boundary's priorities, as the message says. |
| `the api writes absolute URLs ... and 'seampact_<api>.public_origin' is not set` | Set `public_origin` to the origin clients call, such as `https://api.example.com`: a scheme, a host, an optional port, no path. |
| `the api writes relative URLs ... and 'seampact_<api>.public_origin' is set` | Remove `public_origin`, or set `api.wire.urls: absolute` in the contract and generate again. |
| `the PHP extension zlib is not loaded`, `Symfony <x> is not supported` | Enable ext-zlib. Use Symfony 7.4 or 8. |
| `the service validator is missing` | Run `composer require symfony/validator`, and keep `framework.validation` on. |
| `the generated settings class ... lacks its ALIAS constant`, `the access table of api '<api>' has no route for operation '<id>'` | The generated code is stale or edited. Run `seampact generate` again, and do not edit the generated files. |
| `The bundle configuration key seampact_<api>.<key> takes ...` | Fix the value in `config/packages/seampact_<api>.yaml`. `responses` takes `strict` or `warn`, `body_validation` takes `true` or `false`. |
| `the route of operation '<id>' has the path ...`, `... carries a host, a scheme or a condition` | Import the api's routes with no `prefix`, `host`, `schemes` or `condition`. |
| `an app route with the path ... is registered before the route of operation '<id>'` | Import the contract routes first. |
| `the api '<other>' registered before this one answers its catch-all 404` | Set `catchAll: false` on the api whose base path prefixes the other's. |
| `runtime.worker.unsupported` | Serve the app with php-fpm. Worker runtimes are refused. In a functional test, do not call `disableReboot()`. |
| `the app route '<name>' (<path>) is not a contract route and the entry's frameworkRoutes does not list it` | List the route under `frameworkRoutes` of the entry, with a reason, then run `generate`. |
| `operation '<id>' has no route`, `operation '<id>' has <n> routes` | Import the api's resource, type `seampact`, once in your routing configuration. |

An invalid `%env()%` value of the bundle configuration does not stop the start: the api answers 500 on its routes and the log names the key.

## Laravel

The message starts with `seampact: the api '<id>' cannot start:` and lists every problem. It comes at `php artisan route:cache` and at the first HTTP boot while the routes are not cached.

| You see | Do |
|---|---|
| `no authenticate hook for the identity 'user': bind <Interface> in the container` | Bind the generated `<Identity>AuthenticateHook` to your class in a service provider. |
| `no decider for '<name>': tag a Decider naming it, or '*', with 'seampact.<api>.deciders'` | Tag a class implementing the generated `Decider` with that tag. |
| `no scope resolver for the scope '<scope>': tag a ScopeResolver with ...` | Tag a scope resolver with `seampact.<api>.scope-resolvers`. |
| `no idempotency store for ...: bind 'seampact.<api>.idempotency-store' ...` | Bind your `IdempotencyStore` implementation under the provider's `IDEMPOTENCY_STORE_KEY`. |
| `operation '<id>' has no handler: bind <Endpoints> to a controller in the container` | Bind the generated `<Resource>Endpoints` interface to your controller. |
| `the framework route <METHOD> /<path> is outside the contract: allow-list it in the entry's frameworkRoutes, or remove it` | List the route under `frameworkRoutes` of the entry, with a reason, then run `seampact generate`. |
| `operation '<id>' has 0 contract routes: call Route::seampact('<api>') once in the app's routes` | Call `Route::seampact('<api>')` once, from `withRouting(then: ...)` in `bootstrap/app.php`. Call it outside any route group prefix. |
| `the boundary middleware ... is not the first global middleware` | Remove the global middleware you prepended before it. Two apis whose base paths overlap: set `catch_all: false` on the broader one. |
| `the access middleware ... is not before SubstituteBindings in the middleware priority` | Do not reorder the middleware priority; put your own entries after the contract's. |
| `operation '<id>' runs without the access middleware: remove the withoutMiddleware() call on its route` | Remove `withoutMiddleware()` from the contract route. |
| `the exception handler ... has no 'renderable' method` | Make your handler extend Laravel's `Illuminate\Foundation\Exceptions\Handler`. |
| `'seampact.<api>.public_origin' is not set` or `... is '<value>', which ...` | The contract writes absolute URLs. Set `public_origin` in `config/seampact/<api>.php` to a scheme, host and optional port, such as `https://api.example.com`. |
| `the api writes relative URLs ... and 'seampact.<api>.public_origin' is set` | Unset `SEAMPACT_<API>_PUBLIC_ORIGIN` (it fills `public_origin` in `config/seampact/<api>.php`) and run `php artisan config:cache` again if the config is cached, or set `api.wire.urls: absolute` in the contract and generate again. |
| `Laravel <version> runs here, and the generated code serves Laravel 13 only` | Run the app on Laravel 13. |
| `ext-zlib is not loaded` | Enable the `zlib` PHP extension. |
| `... does not return the settings array; regenerate the api '<api>'` | The published `config/seampact/<api>.php` is stale or edited. Run `seampact generate` again, and republish the config if you changed it. |
| `runtime.octane.unsupported` | Serve the app with php-fpm, or keep this api's provider out of the Octane app. |
| `seampact: no generated routes for the api '<api>'; list its service provider in bootstrap/providers.php.` | Add the generated `<Api>SeampactServiceProvider` to `bootstrap/providers.php`. |
| `config('seampact.<api>.middleware.<kind>') is not a list of middleware names` | Set that key in `config/seampact/<api>.php` to a list of strings such as `['auth:sanctum']`, or to `[]`. |
