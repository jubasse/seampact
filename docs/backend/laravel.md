# Laravel

`seampact/laravel` generates the contract's PHP code for Laravel 13. You write the controllers and the hooks; the generated boundary checks each request and each reply.

Laravel 13 on PHP 8.3, 8.4 or 8.5. See [Supported versions](../supported-versions.md).

## Set up

You need:

- PHP with the extensions `json`, `mbstring` and `zlib`;
- Laravel 13 (Laravel 12 and older are refused);
- php-fpm. Octane is refused at start (`runtime.octane.unsupported`).

Install seampact from Packagist. `seampact/hooks` comes with it.

```sh
composer require seampact/laravel
```

In `seampact.config.yaml`, add one entry per api:

```yaml
outDir: app/Generated
targets:
  - id: notes
    out: Notes
    use: seampact/laravel
    api: notes
    options: { rules: seampact-consistent }
```

The classes go into the PSR-4 namespace that `composer.json` gives `outDir` (here `App\Generated\Notes`). Then generate:

```sh
vendor/bin/seampact generate
# or
php artisan seampact:generate
```

When the generated code comes from another seampact version, every other command refuses to boot; `php artisan seampact:generate` still runs.

Commit the generated files. `seampact check` fails CI when they drift from the contract.

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

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

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

## Wire it in

List the generated provider in `bootstrap/providers.php`, and call the route macro once, in `bootstrap/app.php`:

```php
// bootstrap/providers.php
return [
    App\Generated\Notes\Laravel\NotesSeampactServiceProvider::class,
];

// bootstrap/app.php, with use Illuminate\Support\Facades\Route;
->withRouting(
    web: __DIR__.'/../routes/web.php',
    then: fn () => Route::seampact('notes'),
)
```

The provider puts the boundary first in the global middleware, before every other one. Do not prepend another global middleware.

`Route::seampact('notes')` declares one route per operation, with the contract's method and path. Call it once, outside any route prefix. To serve the api under a prefix, set `mount: /api` on the target entry.

- Avoid `routes/web.php`: its group adds sessions and cookies that an API client does not need. One exception: when the contract's cookie credential is Laravel's session (the `web` guard, a Sanctum SPA), call it inside the `web` group. That group starts the session and checks CSRF.
- In `routes/api.php`, set `apiPrefix: ''` in `withRouting()`, since the contract's paths already hold their prefix.
- Your own routes stay beside the contract's. The boot check refuses one that is not in the contract unless `frameworkRoutes` allow-lists it.

### Route names and URLs

Each route is named `seampact.<api>.<operation>`. Its parameters take the names of the input properties:

```php
route('seampact.notes.getNote', ['noteId' => $note->id]);
```

Each api also gets `NotesRouteNames`, one constant per route name, and `NotesUrls`, one method per operation that builds its path from typed parameters. `NotesUrls` returns the contract's path, encoded as the generated clients encode it:

```php
use App\Generated\Notes\Laravel\NotesRouteNames;
use App\Generated\Notes\Laravel\NotesUrls;

route(NotesRouteNames::GET_NOTE, ['noteId' => $note->id]);
NotesUrls::getNote($note->id); // '/v1/notes/42'
```

`artefacts: { routeHelpers: false }` leaves both classes out.

`$request->route('noteId')` works too. Each parameter matches one whole segment, whatever `Route::pattern()` your app sets. `Route::bind('noteId', ...)` needs the `SubstituteBindings` middleware. Routes declared in `withRouting(then:)` do not run it: add `Illuminate\Routing\Middleware\SubstituteBindings::class` to `middleware.<kind>` in the config.

A parameter name over 32 characters gets a positional name instead (`{p2}` for the second parameter), since Laravel's router refuses longer ones.

## Write the hooks

Hooks are container bindings. Bind each identity's `<Identity>AuthenticateHook`, tag the deciders and tag the scope resolvers:

```php
$this->app->bind(UserAuthenticateHook::class, UserHook::class);
$this->app->tag([NotesDecider::class], NotesSeampactServiceProvider::DECIDERS_TAG);
$this->app->tag([WorkspaceResolver::class], NotesSeampactServiceProvider::SCOPE_RESOLVERS_TAG);
```

- A decider lists the names it answers in `names()`, or `Decider::EVERY_NAME` for all of them.
- To be told of each 500 the api answers, bind its `App\Generated\<Api>\Laravel\UnexpectedErrorListener` to your listener.
- An idempotent operation needs a store. Bind a `Seampact\Hooks\IdempotencyStore` under `NotesSeampactServiceProvider::IDEMPOTENCY_STORE_KEY`.

The `params` of a right or rule in a decider request are an instance of the generated class, not an array.

### Use Laravel's own auth

Laravel's layers work beside the contract, and the api's error format answers their refusals:

- **Guards and Sanctum.** Read the user from your guard in the authenticate hook, with `Auth::guard('sanctum')->user()`. If the guard throws `AuthenticationException`, the reply is the contract's 401.
- **Gates and Policies.** Call `Gate::authorize()` in a decider. An `AuthorizationException` is the contract's 403, with the first denial code the right declares. A denial that hides the record, `Response::denyAsNotFound()`, answers the operation's `notFound` code instead when the operation declares one.
- **`abort()`.** `abort(401)`, `abort(403)`, `abort(404)`, `abort(429)` and `abort(503)` from a handler or a middleware answer the contract's `unauthenticated`, `forbidden`, `notFound`, `rateLimited` and `serviceUnavailable` errors. Without that error, any status answers the operation's one code of that status, if it has exactly one with no required params. Otherwise the reply is a 500.
- **`auth` and `auth.session` middleware.** They never redirect on a contract route, so no `login` route is needed.
- **Throttle and CSRF.** `ThrottleRequestsException` is a 429 with its `Retry-After`. When the `rateLimited` code requires `retryAfterMs`, seampact fills it from that header (seconds or an HTTP date). Without a usable one, the reply is a logged 500 (with an optional `retryAfterMs`, the code is answered without it). Laravel's CSRF check runs only on routes that accept a cookie credential; its failure is the contract's 403, not Laravel's 419.

To keep Laravel's rules on a route, add them to your middleware for its kind (`public`, `optional`, `identity` or `signed`):

```php
// config/seampact/notes.php
'middleware' => [
    'identity' => ['auth:sanctum', 'can:use-notes'],
],
```

#### Answer rights with Policies

To answer your rights with Gates and Policies, tag the runtime's `GateDecider` instead of writing a decider:

```php
use Seampact\Laravel\Runtime\GateDecider;

$this->app->tag([GateDecider::class], NotesSeampactServiceProvider::DECIDERS_TAG);

Gate::define('notes.update', [NotePolicy::class, 'update']);
```

- It asks `Gate::forUser($principal)->authorize('<right>', ...)` for every right and rule. A decider of your own that names a right wins over it.
- The user is the principal your authenticate hook returns. To get your `User` model in the Policy, let it implement the identity's generated `<Identity>PrincipalMembers` and return it.
- The arguments are the subject first, then the other scopes, then the request. A scope is the value its resolver loaded: load the model in the resolver and the Policy receives it. A scope with no loaded value arrives as its `SubjectRef` or `ResolvedScope`, never as the raw id, so a client cannot pick the Policy.
- A denial answers the right's first denial code, as `Gate::authorize()` in a decider does. `Response::denyAsNotFound()` answers the operation's `notFound` code when the operation declares one, else the first denial code.

## Options

Set under `options:` on the target entry.

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Laravel's own value rules (`min`, `max`, `uuid`, ...). `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: `mount` (a path prefix), `frameworkRoutes` (see [The boot check](#the-boot-check)), `allowUntested`, and under `artefacts`: `routeHelpers` and `bootCheck`. The full list is in the [configuration reference](../configuration/reference.md#laravel).

### Change a setting without generating again

Each setting reads an environment variable, `SEAMPACT_<API>_<KEY>` (such as `SEAMPACT_NOTES_RESPONSES`), then the generated option. This works before you publish anything. `php artisan vendor:publish --tag=seampact-config` copies `config/seampact/<api>.php`, where you set your own values.

| Key | What it does |
|---|---|
| `responses`, `body_validation`, `framework_etag`, `catch_all` | The options above, changed without generating again. |
| `public_origin` | The origin of absolute URLs, such as `https://api.example.com`. |
| `middleware.public`, `.optional`, `.identity`, `.signed` | Your middleware on one kind of route. |

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

## Signed webhooks

A route signed by a sender (Stripe style) reaches your authenticate hook with the raw body and the signature fields. Check them with `seampact/signed-webhooks`:

```php
public function authenticate(AuthenticateRequest $request): AuthenticateResult
{
    $signed = $request->signature();

    $verified = $signed instanceof SignedTemplateRequest
        && $this->verifier->verify($signed->rawBody, $signed->timestamp, $signed->candidateSignatures, $signed->keyId, $this->scheme($signed))
            ->isVerified();

    return $verified
        ? new AuthenticateResult\Authenticated(new StripePrincipal('acct_1'))
        : new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
}
```

`$this->verifier` is a `TemplateSignatureVerifier` built with your `SecretLookup`, which returns the secrets of a key id. Build the `SignatureScheme` from `$signed->template`. The raw body is the decoded bytes of the request, exactly as received.

## Test your routes

A feature test goes through the boundary like a real request. Send the credential the contract requires, and bind a fake authenticate hook:

```php
$this->app->instance(UserAuthenticateHook::class, new FakeUserHook('alice'));

$this->withToken('test-token')
    ->getJson('/v1/notes/n-1')
    ->assertOk();
```

- `actingAs($user)` alone answers 401: the boundary asks for the contract's credential before your hook runs. Add it: `actingAs($user)->withToken('test-token')`.
- Never call `withoutMiddleware()` with no argument: it removes the boundary, and every contract route answers 500 (with `APP_DEBUG=true`, Laravel's error page names the bypass). Remove one middleware by name instead, such as `withoutMiddleware(ThrottleRequests::class)`.
- Replace a decider, a scope resolver or a store the same way, with `$this->app->instance()`.
- A request with a body works as usual: `postJson()` reaches the handler with that body, checked like a real request.

To call a handler directly in a unit test, build its request with `forTest()`. It takes the input, then the caller when the route has an identity, then the scopes when it runs in scopes. Use it for direct handler calls only: never bind it into the container in a feature test, a route refuses it.

```php
$request = GetNoteRequest::forTest(
    new GetNoteInput(new GetNotePath('n-1')),
    new UserPrincipal('alice'),
    new GetNoteScopes(new ResolvedScope('workspace', 'w-1', $workspace)),
);

$result = $controller->getNote($request);
```

`ResolvedScope` is `Seampact\Hooks\ResolvedScope`.

### Debug locally

With `APP_DEBUG=true`, an exception that no contract error maps shows Laravel's error page, as on any route. The boundary's log line also names its message and `file:line`. With `APP_DEBUG=false`, the client gets the api's 500, and the log names only the exception class.

A reply that breaks the contract is still a 500 in debug. To see it while you work, set `SEAMPACT_NOTES_RESPONSES=warn` in your local `.env`: the reply goes out and the log names the problem.

## Deploy

- Run the app with php-fpm.
- The web server's body limit and `post_max_size` must be at least the largest route limit of the contract.
- Run `php artisan route:cache` and `php artisan config:cache` in production, with the production environment variables set. The boot check then runs once, at that step.
- To serve the api under a prefix, set `mount: /api` on the target entry. Do not add the prefix in Laravel too.
- When the contract writes absolute URLs (`api.wire.urls: absolute`), set `public_origin` (`SEAMPACT_NOTES_PUBLIC_ORIGIN`). The app refuses to start without it, and refuses it when the contract writes relative URLs. The request's `Host` is never read.
- Behind a proxy, set Laravel's `trustProxies()`. It changes Laravel's URL helpers, never the contract's URLs.

In Docker, take a php-fpm image with `mbstring` and `zlib`, and put the web server (nginx) in front. The generated code is committed, so the image needs no seampact tool. Pass `APP_KEY`, `SEAMPACT_*` and your other settings as environment variables, never baked into the image.

```dockerfile
FROM composer:2 AS vendor
WORKDIR /app
COPY . .
RUN composer install --no-dev --optimize-autoloader --ignore-platform-reqs

FROM php:8.5-fpm
WORKDIR /var/www/html
COPY --from=vendor /app .
```

### The boot check

The app refuses to start, and lists every problem. It runs at `php artisan route:cache`, and at an HTTP boot without a route cache. Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#laravel).

| Fault | Fix |
|---|---|
| An identity has no authenticate hook, a right or rule no decider, a scope no resolver. | Bind the hook, tag the decider or the resolver. |
| An idempotent operation has no store. | Bind one under `IDEMPOTENCY_STORE_KEY`. |
| An operation has no handler, or its route is missing or served twice. | Bind the endpoints interface; call `Route::seampact()` once. |
| A route that is not in the contract is served and not allow-listed. | Add it to `frameworkRoutes` on the entry, or remove it. |
| The boundary is not the first global middleware, or the access middleware is not before `SubstituteBindings`. | Do not prepend another global middleware; keep the order of `middleware.<kind>`. |
| The contract writes absolute URLs and `public_origin` is missing or is not a scheme, host and port. | Set `SEAMPACT_<API>_PUBLIC_ORIGIN`, such as `https://api.example.com`. |
| The contract writes relative URLs and `public_origin` is set. | Unset it. |
| A route group prefix is on a contract route. | Use `mount` on the entry instead. |

By default the check reads only routes that reach a path of the api; `artefacts.bootCheck.frameworkRoutes: strict` checks them all. Allow-list your own routes in the entry, with a reason. Laravel's health route and Sanctum's CSRF cookie route need no entry.

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

Admin panels serve their own routes. Keep the lines of the tools you use. A panel on another path takes that path (`/backoffice/**`). A `*` inside a segment matches any characters but `/`.

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Filament panel." }
      - { path: "/filament/**", reason: "Filament exports and imports." }
      - { path: "/livewire*/**", reason: "Livewire updates, scripts and uploads." }
      - { path: "/horizon/**", reason: "Horizon dashboard." }
      - { path: "/telescope/**", reason: "Telescope dashboard." }
      - { path: "/nova/**", reason: "Nova panel." }
      - { path: "/nova-api/**", reason: "Nova panel." }
      - { path: "/nova-vendor/**", reason: "Nova panel." }
```

## Limits

- `generate` refuses some forms by name, until an app needs them. The list is in [Generate errors](../troubleshooting/generate.md#php); forms refused on every server are under [every server](../troubleshooting/generate.md#every-server).
- A query list is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`.
- Symfony is a separate target: see [Symfony](symfony.md).

## Next

- [Call the api from React](../frontend/react.md)
- [Check the generated code in CI](../features/check-in-ci.md)
