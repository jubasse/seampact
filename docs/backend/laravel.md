# Write the handlers (Laravel)

`seampact/laravel` generates the contract's PHP code for Laravel 13. You write the controllers and the hooks; the generated boundary checks each request and each reply.

## Set up

Laravel 13 on PHP 8.3, 8.4 or 8.5 (the CI runs 8.3 and 8.5, on Laravel 13.38). The extensions `json`, `mbstring` and `zlib` must be loaded. Octane is refused at start.

Nothing is published to Packagist yet, so Composer installs seampact from your checkout. Replace `~/src/seampact` with the path of your checkout.

```sh
composer config minimum-stability dev
composer config prefer-stable true
composer config repositories.seampact path "$HOME/src/seampact/php/*"
composer require seampact/laravel seampact/hooks
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

Commit the generated files. `seampact check` fails CI when they drift from the contract.

Options of the entry (all optional), set under `options:` as above:

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Laravel's own value rules (`min`, `max`, `uuid`, ...). `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

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

## Routes

`Route::seampact('notes')` declares one route per operation, with the contract's method and path. Each route runs the access middleware, then your middleware for its kind (see the config below).

Call it once, outside any route prefix. `withRouting(then:)` does that. In `routes/api.php`, set `apiPrefix: ''` in `withRouting()`, since the contract's paths already hold their prefix. Avoid `routes/web.php`: its group adds sessions and cookies that an API client does not need. One exception: when the contract's cookie credential is Laravel's session (the `web` guard, a Sanctum SPA), call it inside the `web` group. That group starts the session and checks CSRF.

Each route is named `seampact.<api>.<operation>`. Its parameters take the names of the input properties:

```php
route('seampact.notes.getNote', ['noteId' => $note->id]);
```

Each api also gets `NotesRouteNames`, one constant per route name, and `NotesUrls`, one method per operation that builds its path from typed parameters. `NotesUrls` returns the contract's path, encoded as the generated clients encode it. That is the routed path, since the boot check refuses a route group prefix:

```php
use App\Generated\Notes\Laravel\NotesRouteNames;
use App\Generated\Notes\Laravel\NotesUrls;

route(NotesRouteNames::GET_NOTE, ['noteId' => $note->id]);
NotesUrls::getNote($note->id); // '/v1/notes/42'
```

`artefacts: { routeHelpers: false }` leaves both classes out.

`$request->route('noteId')` works too. Each parameter matches one whole segment, whatever `Route::pattern()` your app sets.

`Route::bind('noteId', ...)` needs the `SubstituteBindings` middleware. Routes declared in `withRouting(then:)` do not run it: add `Illuminate\Routing\Middleware\SubstituteBindings::class` to `middleware.<kind>` in the config.

`generate` refuses a path segment that mixes a parameter with text (`path.segment.mixed.unsupported`), and a static segment with `{`, `}` or `?` (`path.segment.literal.unsupported`). A parameter name over 32 characters gets a positional name instead (`{p2}` for the second parameter), since Laravel's router refuses longer ones.

Your own routes stay beside the contract's, in your routes files. The boot check refuses one that is not in the contract unless `frameworkRoutes` allow-lists it (see [The boot check](#the-boot-check)).

## Write a controller

Each resource has a generated `<Resource>Endpoints` interface. Each method takes the operation's `FormRequest` and returns one arm of its result: `GetNoteResponse200` and the like, or an error of `GetNoteErrors`. Bind the interface to your controller in a service provider.

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

### With Eloquent

The handler maps your model to the contract's type. Extra columns never leave the boundary: the reply holds only the contract's fields.

```php
return new GetNoteResponse200(new Note($row->id, $row->title, $row->created_at->toDateTimeImmutable()));
```

The same holds for an API Resource: build the generated type from it.

## Paging

With `@seampact/pack-laravel`, installed from your checkout as [Get started](../getting-started/01-install.md) installs the npm packages (it is not on npm yet), a paged list answers Laravel's paginator, and the boundary writes `{ data, links, meta }` for you.

The boundary validates `page` and `per_page` first. Use the validated values from `contractInput()`. Laravel's own page resolver falls back to page 1 on a bad value, so do not rely on it.

```php
$query = $request->contractInput()->query;
$page = $query->page ?? 1;
$perPage = $query->perPage ?? 20;

$notes = Note::query()->paginate($perPage, ['*'], 'page', $page);

return new ListNotesResponse200(new LengthAwarePaginator($notes->items(), $notes->total(), $perPage, $page));
```

The page and the limit in the reply are the request's, never the paginator's own. Cursor paging answers a `CursorPaginator` the same way. Without the pack, a list returns the generated `<Operation>Page` class.

## Register the hooks

Hooks are container bindings. Bind each identity's `<Identity>AuthenticateHook`, tag the deciders and tag the scope resolvers:

```php
$this->app->bind(UserAuthenticateHook::class, UserHook::class);
$this->app->tag([NotesDecider::class], NotesSeampactServiceProvider::DECIDERS_TAG);
$this->app->tag([WorkspaceResolver::class], NotesSeampactServiceProvider::SCOPE_RESOLVERS_TAG);
```

A decider lists the names it answers in `names()`, or `Decider::EVERY_NAME` for all of them.

## Laravel's own auth

Laravel's layers work beside the contract, and the api's error format answers their refusals:

- **Guards and Sanctum.** Read the user from your guard in the authenticate hook, with `Auth::guard('sanctum')->user()`. If the guard throws `AuthenticationException`, the reply is the contract's 401.
- **Gates and Policies.** Call `Gate::authorize()` in a decider. An `AuthorizationException` is the contract's 403, with the first denial code the right declares.
- **`abort()`.** `abort(401)`, `abort(403)`, `abort(404)`, `abort(429)` and `abort(503)` from a handler or a middleware answer the contract's `unauthenticated`, `forbidden`, `notFound`, `rateLimited` and `serviceUnavailable` errors. Without that error, any status answers the operation's one code of that status, if it has exactly one with no required params. Otherwise the reply is a 500.
- **`auth` and `auth.session` middleware.** They never redirect on a contract route, so no `login` route is needed.
- **Throttle and CSRF.** `ThrottleRequestsException` is a 429 with its `Retry-After`. Laravel's CSRF check runs only on routes that accept a cookie credential; its failure is the contract's 403, not Laravel's 419.

The generated per-kind lists put your own middleware on a kind of route (see the config below). To keep Laravel's rules on a route, add them there:

```php
// config/seampact/notes.php
'middleware' => [
    'identity' => ['auth:sanctum', 'can:use-notes'],
],
```

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

## Config per api

Each setting reads an environment variable, `SEAMPACT_<API>_<KEY>` (such as `SEAMPACT_NOTES_RESPONSES`), then the generated option. This works before you publish anything. `php artisan vendor:publish --tag=seampact-config` copies `config/seampact/<api>.php`, where you set your own values.

| Key | What it does |
|---|---|
| `responses`, `body_validation`, `framework_etag`, `catch_all` | The options above, changed without generating again. |
| `public_origin` | The origin of absolute URLs, such as `https://api.example.com`. |
| `middleware.public`, `.optional`, `.identity`, `.signed` | Your middleware on one kind of route. |

When the contract writes absolute URLs (`api.wire.urls: absolute`), set `public_origin` (`SEAMPACT_NOTES_PUBLIC_ORIGIN`). The app refuses to start without it, and refuses it when the contract writes relative URLs. The request's `Host` is never read. Behind a proxy, set Laravel's `trustProxies()`; it changes Laravel's URL helpers, never the contract's URLs.

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver, an idempotent operation no store;
- an operation has no handler, or its route is missing or served twice;
- a route that is not in the contract is served and not allow-listed;
- the boundary is not the first global middleware, or the access middleware is not before `SubstituteBindings`;
- the contract writes absolute URLs and `public_origin` is missing or is not a scheme, host and port;
- the contract writes relative URLs and `public_origin` is set.

The check runs at `php artisan route:cache` and at an HTTP boot without a route cache. Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md).

Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

Laravel's health route and Sanctum's CSRF cookie route need no entry.

## Admin panels and tools

Filament, Livewire, Horizon, Telescope and Nova serve their own routes. Allow-list them in the entry:

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

Keep only the lines of the tools you use. A panel on another path takes that path (`/backoffice/**`). A `*` inside a segment matches any characters but `/`, so `/livewire*/**` also matches the paths Livewire 4 hashes (`/livewire-<hash>/upload-file`).

Octane is not supported yet.

## Limits and deployment

- Run the app with php-fpm. Octane fails with `runtime.octane.unsupported`.
- The web server's body limit and `post_max_size` must be at least the largest route limit of the contract.
- Run `php artisan route:cache` and `config:cache` in production. The boot check then runs once, at build time.
- Form, multipart, file, download and redirect bodies, and `accessHooks: false`, are refused by `generate` by name: they wait for an app that needs them. See [Target option errors](../troubleshooting/generate.md).
- Laravel 12 and older are refused. Symfony and API Platform are separate targets.
