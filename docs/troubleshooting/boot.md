# Boot errors

The generated server checks itself when the app starts. A problem stops the start with a message that lists every problem, like this.

```text
seampact: the api 'notes' cannot start:
- operation 'getNote': handlers.NotesEndpoints has no method getNote(); fix: implement getNote() on the NotesEndpoints object.
```

Fix every line, then start again. Each section below names the framework and when its check runs.

## Every server

| You see | Cause and fix |
|---|---|
| `runtime.generated-for-other-version` | The generated code was written by another seampact version than the installed runtime. Run `seampact generate` again, or install the runtime at the generator's version. |

On PHP, `seampact:generate` still runs under this skew. The `runtime.*` codes raised by `generate` are in [Generate errors](generate.md#every-server).

### Allow-listing framework routes

Several servers refuse a route of yours that is not in the contract (`frameworkRoutes`). List the route under `frameworkRoutes` of the target entry, with a reason, then run `seampact generate`. Two cases need more than the route itself:

- A route with an optional parameter (`/c/:id?`, `/c{/:id}`, `/c/{id?}`) also serves `/c`. `/c/*` alone does not list it: add `/c` too.
- A route that may take more than one segment (`/c/:rest+`, `/c/:rest{.+}`, `/c/:id{/:page}`) needs `/c/**`.

By default only routes that reach a path of the api are checked. Set `artefacts.bootCheck.frameworkRoutes: strict` to check every route. See [OpenAPI and docs](../configuration/openapi-and-docs.md).

## Node servers

Express, Fastify, Hono, NestJS and AdonisJS. The check runs when the app starts and the message starts with `seampact: the api '<id>' cannot start:`.

| You see | Cause and fix |
|---|---|
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | The app has a route the contract does not declare. [Allow-list it](#allow-listing-framework-routes). |
| `differs from the entry's mount (write the prefix as the entry's 'mount' in seampact.config.yaml instead)` | The framework adds a prefix (route group, plugin prefix, `basePath`, mount path) the contract does not know. Remove it from the framework and set `mount` on the target entry. |
| `handlers has no 'NotesEndpoints' object` | Pass one object per generated handler interface. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method on that object. |
| `'bodyValidation' is turned on, but the target generated no output validators` | Set `bodyValidation: true` in the target's `options`, then run `generate`. |
| `no authenticate hook for the identity 'user'` | Register `authenticate.user` in your hooks. |
| `no decider for '<name>'` | Register a decider whose `names` lists it, or one with `names: all`. |
| `no scope resolver for the scope '<scope>'` | Register `scopeResolvers.<scope>`. |
| `no idempotency store for an idempotent operation` | Register `idempotencyStore`, for example `createMemoryIdempotencyStore()` of `@seampact/idempotency-memory`. |
| `two deciders claim '<name>'` | Keep the name in one decider. |
| `'inputRules' names '<id>', which is no operation of the api` | Key [your input rules](../backend/express.md#add-your-own-rules) by an operation id the fix lists. An operation the entry's `operations` filter drops takes no rules. |
| `'inputRules' names the relay of '<api>.<id>', which takes no rules` | Register the rules on the gateway's own operation, which checks the input before it forwards. |
| `its 'inputRules' entry names the part '<part>'` | Key the rules by part: `path`, `query`, `headers` or `body`. |
| `its 'inputRules' entry has rules for '<part>', where the operation takes no input` | Remove those rules, or declare that input in the contract. |
| `the api's generated validators are in no library input rules support` | Input rules are written in the validators' library: generate them with zod or yup, or the Fastify target's own Ajv validators. |
| `an app input rule of '<id>' on its <part> reports no usable name` (a warning at run time) | The refusal answered `app.invalid`. Name the rule as the warning's fix says: zod `params: { rule }`, yup `.test({ name })`, or the Ajv keyword. |

### NestJS

| You see | Cause and fix |
|---|---|
| `the seampact guard is not the last guard of <method>()` | Do not register a guard after the contract decorator on that route. |
| `<method>() has no input parameter, so its input is never validated` | Add `@<Op>.input() input`, or one of its parts such as `@<Op>.body() body`. |
| `the app interceptor <name> can answer <route> from its cache` | Keep cache interceptors off contract routes. The contract's `cache` sets the reply headers. |
| `<decorator> on <method>() writes after the boundary's reply` | Remove the decorator: return the reply instead. |
| `a @Res(), @Response() or @Next() parameter on <method>() writes after the boundary's reply` | Remove the parameter: return the reply instead. |
| `@HttpCode on <method>() sets a status the boundary never writes` | Remove `@HttpCode`. Return the status from the handler. |
| `@Header on <method>() sets a header the boundary never writes` | Remove `@Header`. Declare the header in the contract's response. |
| `@Controller('<path>') on <Controller> prefixes the contract route` | Use `@Controller()` with no path. The contract's paths are absolute. |
| `RouterModule mounts <Module> under '<path>'` | Remove that `RouterModule` entry, or move the controller to a module it does not mount. |
| `setGlobalPrefix('<prefix>') prefixes <route>` | Exclude the contract routes with the `exclude` option of `setGlobalPrefix`, or remove the prefix. |
| `the api '<id>' is registered twice` | Import `SeampactModule.forRoot` or `forRootAsync` once per api. |
| `the NestJS platform is '<x>'` | Use `@nestjs/platform-express`. |
| `bodyValidation is on, but the target was generated without its response validators` | Set `bodyValidation: true` in the target's `options`, then run `generate`. Or leave `bodyValidation` out of `forRoot`. |
| `'<key>' is not an option of SeampactModule.forRoot` | `forRoot` takes `{ logger, responses, bodyValidation, unboundOperations }`. |
| `'responses' is "<x>", not 'strict' or 'warn'`, `'bodyValidation' is "<x>", not true or false` | Pass `'strict'` or `'warn'`, `true` or `false`, or leave the option out. |
| `no JSON parser read the body of '<operation>'` (a 500 at run time) | Call `configureApp(app)` before `app.listen`, or give the app a JSON parser with `limit: LARGEST_BODY_LIMIT`. |
| `configureApp found a JSON parser installed before it`, `a JSON parser was installed after configureApp(app)` | Remove your `app.useBodyParser("json", ...)` or `express.json()`, and pass its options to `configureApp(app, { appJsonParser: { limit: "5mb" } })`. Or skip `configureApp` and install the parsers yourself. |
| `appJsonParser is passed to a second configureApp call` | Pass `appJsonParser` to the app's first `configureApp` call only. |
| `configureApp's appJsonParser takes limit and strict` | Pass `limit` or `strict` only. For other parser options, skip `configureApp` and install the parsers yourself. |
| `@<op>.<part>() is on <method>(), the method of '<other>'` | Use the part decorator of the method's own operation, as the fix names. |
| `createContractDocument of api '<id>' got autoTagControllers: true` | Remove the option: `createContractDocument` sets it to `false`. |

Two checks only warn, and the app still starts: global interceptors that run outside the reply interceptor, and request-scoped interceptors that cannot be checked at boot.

## Symfony

The check runs with `bin/console cache:warmup` and on the first request. The message starts with `seampact: the api 'tasks' cannot start:`, or with `the api 'tasks' cannot start:` for the hook lines.

| You see | Cause and fix |
|---|---|
| `no authenticate hook for the identity '<id>'` | An identity the contract declares has no hook service. Register one service implementing the generated `<Id>AuthenticateHook`, with autoconfiguration on. At run time the same error reads `seampact: the api '<api>' has no authenticate hook for the identity '<id>'; ...`. |
| `no decider for '<name>'` | A right or rule name has no decider. Register a service implementing the api's `Decider` that names it, or `[Decider::EVERY_NAME]`. |
| `no scope resolver for the scope '<scope>'` | A scope has no resolver service. Register a service implementing the api's `ScopeResolver`. |
| `two deciders claim '<name>'` | Two services answer the same name. Keep the name in one decider. |
| `no idempotency store for '<operation>'` | An idempotent operation has no store. Alias `seampact.<api key>.idempotency_store` to a service implementing `Seampact\Hooks\IdempotencyStore`. |
| `operation '<id>' has no handler` | No controller serves the operation. Register one controller service implementing the `<Resource>Endpoints` interface. |
| `the method <class>::<method> handles operation '<id>' but is not marked #[SeampactOperation('<id>')]` | The method has no operation attribute. Add `#[SeampactOperation('<id>')]`. |
| `the controller <class> carries #[IsGranted]` | `#[IsGranted]` would decide access outside the contract. Remove it. For a plain role check, paste the `access_control` rule the message prints; for anything else, write a decider. |
| `the method <class>::<method> carries #[IsGranted]` | `#[IsGranted]` on a method has the same effect as on the controller. Same as the controller form. |
| `the controller <class> carries #[IsCsrfTokenValid]`, `the method <class>::<method> carries #[IsCsrfTokenValid]` | The attribute checks the CSRF token outside the contract. Remove it, and check the CSRF value in the authenticate hook. |
| `the controller <class> carries #[IsSignatureValid]`, `the method <class>::<method> carries #[IsSignatureValid]` | A signed URI is not a form the contract declares. Remove the attribute. |
| `framework.http_cache is on` | HttpCache serves replies that never reach the boundary. Turn it off. |
| `the input resolver service ... is not registered as a value resolver` | The bundle is not loaded, so its resolver is missing. List the api's bundle in `config/bundles.php`. |
| `the service <id> listens to kernel.request at priority ...`, `... kernel.response at priority ...` | Your listener runs outside the boundary's priorities. Move it inside them, as the message says. |
| `the api writes absolute URLs ... and 'seampact_<api>.public_origin' is not set` | The contract writes absolute URLs and the origin is unknown. Set `public_origin` to the origin clients call, such as `https://api.example.com`: a scheme, a host, an optional port, no path. |
| `the api writes relative URLs ... and 'seampact_<api>.public_origin' is set` | The contract writes relative URLs, so an origin has no use. Remove `public_origin`, or set `api.wire.urls: absolute` in the contract and generate again. |
| `the PHP extension zlib is not loaded`, `Symfony <x> is not supported` | The app runs without ext-zlib, or on an unsupported Symfony. Enable ext-zlib. Use Symfony 7.4 or 8. |
| `the service validator is missing` | Body validation needs the Symfony validator. Run `composer require symfony/validator`, and keep `framework.validation` on. |
| `the generated settings class ... lacks its ALIAS constant`, `the access table of api '<api>' has no route for operation '<id>'` | The generated code is stale or edited. Run `seampact generate` again, and do not edit the generated files. |
| `The bundle configuration key seampact_<api>.<key> takes ...` | A bundle option has a wrong value. Fix it in `config/packages/seampact_<api>.yaml`. `responses` takes `strict` or `warn`, `body_validation` takes `true` or `false`. |
| `the route of operation '<id>' has the path ...`, `... carries a host, a scheme or a condition` | The route import changes the contract path. Import the api's routes with no `prefix`, `host`, `schemes` or `condition`. |
| `an app route with the path ... is registered before the route of operation '<id>'` | An app route would answer before the contract route. Import the contract routes first. |
| `the api '<other>' registered before this one answers its catch-all 404` | Two apis nest, and the first one's catch-all 404 hides the second. Set `catchAll: false` on the api whose base path prefixes the other's. |
| `runtime.worker.unsupported` | A worker runtime keeps state between requests, which the boundary refuses. Serve the app with php-fpm. In a functional test, do not call `disableReboot()`. |
| `the app route '<name>' (<path>) is not a contract route and the entry's frameworkRoutes does not list it` | The app has a route the contract does not declare. [Allow-list it](#allow-listing-framework-routes). |
| `operation '<id>' has no route`, `operation '<id>' has <n> routes` | The routes are not imported, or imported twice. Import the api's resource, type `seampact`, once in your routing configuration. |

An invalid `%env()%` value of the bundle configuration does not stop the start: the api answers 500 on its routes and the log names the key.

## Laravel

The check runs at `php artisan route:cache` and at the first HTTP boot while the routes are not cached.

| You see | Cause and fix |
|---|---|
| `no authenticate hook for the identity 'user': bind <Interface> in the container` | The identity has no hook in the container. Bind the generated `<Identity>AuthenticateHook` to your class in a service provider. |
| `no decider for '<name>': tag a Decider naming it, or '*', with 'seampact.<api>.deciders'` | A name has no decider. Tag a class implementing the generated `Decider` with `seampact.<api>.deciders`. |
| `no scope resolver for the scope '<scope>': tag a ScopeResolver with ...` | A scope has no resolver. Tag a scope resolver with `seampact.<api>.scope-resolvers`. |
| `no idempotency store for ...: bind 'seampact.<api>.idempotency-store' ...` | An idempotent operation has no store. Bind your `IdempotencyStore` implementation under the provider's `IDEMPOTENCY_STORE_KEY`. |
| `operation '<id>' has no handler: bind <Endpoints> to a controller in the container` | No controller serves the operation. Bind the generated `<Resource>Endpoints` interface to your controller. |
| `<Class> has input rules for operation '<id>', which api '<api>' lacks or whose entry's operations filter drops` | The rule class names an operation that is not served. Fix the id in `operationId()`, or remove the class. |
| `<Class> has input rules for the part '<part>' of operation '<id>', which has no ...` | The operation has no input in that part. Name a part the message lists, or remove the class. |
| `<Class> has input rules for operation '<id>', which relays '<id>' of api '<api>'` | A relay operation takes no rules. Put them on the public operation in the gateway. |
| `two input rule sets claim the part '<part>' of operation '<id>'` | Two classes cover one part. Merge their rules into one class. |
| `the input rules service <Class> does not implement ...` | A class tagged `seampact.<api>.input_rules` is not the api's `InputRules`. Implement the generated `InputRules` interface, or untag it. |
| `the framework route <METHOD> /<path> is outside the contract: allow-list it in the entry's frameworkRoutes, or remove it` | The app has a route the contract does not declare. [Allow-list it](#allow-listing-framework-routes), or remove the route. |
| `operation '<id>' has 0 contract routes: call Route::seampact('<api>') once in the app's routes` | The contract routes are not registered. Call `Route::seampact('<api>')` once, from `withRouting(then: ...)` in `bootstrap/app.php`, outside any route group prefix. |
| `the boundary middleware ... is not the first global middleware` | A global middleware runs before the boundary. Remove the one you prepended. Two apis whose base paths overlap: set `catch_all: false` on the broader one. |
| `the access middleware ... is not before SubstituteBindings in the middleware priority` | The middleware priority was reordered. Do not reorder it; put your own entries after the contract's. |
| `operation '<id>' runs without the access middleware: remove the withoutMiddleware() call on its route` | `withoutMiddleware()` skips the access check. Remove the call from the contract route. |
| `the exception handler ... has no 'renderable' method` | The exception handler is not Laravel's. Make your handler extend `Illuminate\Foundation\Exceptions\Handler`. |
| `'seampact.<api>.public_origin' is not set` or `... is '<value>', which ...` | The contract writes absolute URLs and the origin is unknown. Set `public_origin` in `config/seampact/<api>.php` to a scheme, host and optional port, such as `https://api.example.com`. |
| `the api writes relative URLs ... and 'seampact.<api>.public_origin' is set` | The contract writes relative URLs, so an origin has no use. Unset `SEAMPACT_<API>_PUBLIC_ORIGIN` (it fills `public_origin`) and run `php artisan config:cache` again if the config is cached, or set `api.wire.urls: absolute` in the contract and generate again. |
| `Laravel <version> runs here, and the generated code serves Laravel 13 only` | The app runs another Laravel version. Run the app on Laravel 13. |
| `ext-zlib is not loaded` | The PHP extension is missing. Enable the `zlib` extension. |
| `... does not return the settings array; regenerate the api '<api>'` | The published config is stale or edited. Run `seampact generate` again, and republish the config if you changed it. |
| `runtime.octane.unsupported` | Octane keeps state between requests, which the boundary refuses. Serve the app with php-fpm, or keep this api's provider out of the Octane app. |
| `seampact: no generated routes for the api '<api>'; list its service provider in bootstrap/providers.php.` | The provider is not registered. Add the generated `<Api>SeampactServiceProvider` to `bootstrap/providers.php`. |
| `config('seampact.<api>.middleware.<kind>') is not a list of middleware names` | The middleware key is not a list. Set it in `config/seampact/<api>.php` to a list of strings such as `['auth:sanctum']`, or to `[]`. |

## Django (DRF)

The check runs when the server loads the app, and `python manage.py seampact_check` prints the same list.

| You see | Cause and fix |
|---|---|
| `settings.SEAMPACT['<api>']['public_origin'] is not set` or `... is '<value>', which ...` | The contract writes absolute URLs and the origin is unknown. Set `public_origin` to a scheme, host and optional port, such as `https://api.example.com`. |
| `the api '<api>' writes relative URLs ... and settings.SEAMPACT['<api>']['public_origin'] is set` | The contract writes relative URLs, so an origin has no use. Remove `public_origin`, or set `api.wire.urls: absolute` in the contract and generate again. |
| `settings.SEAMPACT['<api>']['access'] has the unknown access kind '<kind>'` | The access kind is not one the contract knows. Key `access` by `public`, `optional`, `identity` or `signed`. |
| `settings.SEAMPACT['<api>']['access'] names the access kind '<kind>', which no operation of the api has` | No operation uses that kind. Remove it. |
| `settings.SEAMPACT['<api>']['access']['<kind>']['<name>'] names '<path>', which ...` | The class is not of the matching DRF base. Name DRF classes by dotted path: `BaseAuthentication`, `BasePermission` or `BaseThrottle`. |
| `operation '<id>': no URL pattern serves <path> (its pattern sits at <served path>)` | The include prefix hides the contract path. Include the api's urls at `""` and set the entry's `mount` to the prefix you removed. |

## Django Ninja

The check runs when the server loads the app, and `python manage.py seampact_check` prints the same list. See [The boot check](../backend/ninja.md#the-boot-check).

| You see | Cause and fix |
|---|---|
| `the api '<api>' is not bound: call bind_<api>(...)` | No code binds the api to the `NinjaAPI`. Call `bind_<api>(api, prefix=..., handlers=...)` in the module that builds the `NinjaAPI` your root URLconf includes. |
| `settings.SEAMPACT['<api>'] is set, and the api takes its values from bind_<api>()` | Ninja reads its values from `bind_<api>()`, not from settings. Remove that settings entry and pass its values to `bind_<api>()`. |
| `the api '<api>' sets bodyValidation, which this release of seampact-ninja does not serve yet` | This release of seampact-ninja does not serve `bodyValidation`. Remove `bodyValidation` from the entry and `body_validation` from `bind_<api>()`. |
| `the api '<api>' writes absolute URLs ... and bind_<api>(public_origin=...) is not set` | The contract writes absolute URLs and the origin is unknown. Pass `public_origin="https://api.example.com"` (a scheme, a host, an optional port) to `bind_<api>()`. |
| `the api '<api>' writes relative URLs ... and bind_<api>(public_origin=...) is set` | The contract writes relative URLs, so an origin has no use. Drop `public_origin` from the call, or set `api.wire.urls: absolute` in the contract and generate again. |
| `bind_<api>(access=...) has the unknown access kind '<kind>'` | The access kind is not one the contract knows. Key `access` by `public`, `optional`, `identity` or `signed`. |
| `bind_<api>(access=...) names the access kind '<kind>', which no operation of the api has` | No operation uses that kind. Remove it. |
| `bind_<api>(responses=...) is '<value>'; set one of strict, warn.` | The responses mode is not valid. Pass `"strict"`, `"warn"`, or nothing. The same holds for `operations['<id>'].responses`. |
| `bind_<api>(operations=...)['<id>'] is a <type>; set an OperationSettings.` | The per-operation value has the wrong type. Pass `OperationSettings(responses=...)` from `seampact.ninja.runtime` for each operation. |
| `bind_<api>(body_validation=...) is '<value>'; set True or False.` | The value is not a bool. Pass `True` or `False`, or leave the argument out. |
| `bind_<api>(access=...) gives the access kind '<kind>' an auth=, and its operation '<id>' declares no code for the role 'unauthenticated' ...` | The operation has no error to answer a failed auth with. Declare an `unauthenticated` error on that operation, or remove the `auth=` from the kind. |
| `bind_<api>(access=...) gives the access kind '<kind>' a throttle, and its operation '<id>' declares no code for the role 'rateLimited' ...` | The operation has no error to answer a throttled call with. Declare a `rateLimited` error on that operation, or remove the throttle from the kind. |
| `operation '<id>': no URL pattern serves <path> (its pattern sits at <served path>); include the NinjaAPI's urls at a prefix that, followed by bind_<api>(prefix=...), equals the entry's mount.` | The URL prefixes do not add up to the contract path. Make the include prefix of `api.urls` plus `prefix` equal the entry's `mount`. |
| `seampact: bind_<api>() was already called on this NinjaAPI` (a `BindingError` at import) | The api is bound twice (a `BindingError` at import). Call `bind_<api>()` once per `NinjaAPI`. |
| `the NinjaAPI's on_exception was replaced after bind_<api>()` | Something replaced the error handler seampact installed. Replace `api.on_exception` before calling `bind_<api>()`. |
| `bind_<api>() gets ..., which builds a <Class> whose method '<name>' is an async def` | The generated views are sync and the method is not. Write the method as a plain `def`, or generate with `views: async`. |

## Spring Boot

See [The boot check](../backend/spring-boot.md#the-boot-check).

| You see | Cause and fix |
|---|---|
| `operation '<id>': no handler is bound` | No controller method serves the operation. Implement it in a `@RestController` method with its annotation. In a `@WebMvcTest` slice that loads some controllers, set `seampact.<api>.unbound-operations=warn`. |
| `'seampact.<api>.unbound-operations' is '<value>', not 'error' or 'warn'` | The setting has an unknown value. Set it to `warn` in a test slice, or remove it. |
| `operation '<id>': Spring MVC maps its handler <method> at <path>, not at the entry's mount followed by the contract path, <path>` | The app adds a prefix the contract does not know. Remove it (`addPathPrefix`, a class-level `@RequestMapping`) and set the entry's `mount` to it: the generated annotations already hold the mount. |

## FastAPI

The check runs on startup by uvicorn (`Application startup failed. Exiting.`), or on the first request without a lifespan.

| You see | Cause and fix |
|---|---|
| `` the api '<api>' writes absolute URLs ... and the `public_origin` argument of bind_<api>() is not set `` | The contract writes absolute URLs and the origin is unknown. Pass `public_origin="https://api.example.com"` (the origin clients call: a scheme, a host, an optional port, no path) to `bind_<api>()`. |
| `` the `public_origin` argument of bind_<api>() is '<value>', which ... `` | The origin is malformed. Use a scheme (`http` or `https`), a host and an optional port. |
| `` the api '<api>' writes relative URLs ... and the `public_origin` argument of bind_<api>() is set `` | The contract writes relative URLs, so an origin has no use. Drop `public_origin` from the call, or set `api.wire.urls: absolute` in the contract and generate again. |
| `operation '<id>': no route of the app takes '<method> <path>' (its route sits at '<served path>')` | The router is included with a prefix the contract does not know. Include the router passed to `bind_<api>()` with no prefix, and set the entry's `mount` to the prefix you removed. |
