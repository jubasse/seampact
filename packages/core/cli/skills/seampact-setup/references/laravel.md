<!-- Generated from docs/backend/laravel.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Laravel

Page: https://jubasse.github.io/seampact/backend/laravel/

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

The request is checked by the [Laravel rules](https://jubasse.github.io/seampact/types-and-validation/laravel-rules/) of a generated `FormRequest`; see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

The classes go into the PSR-4 namespace that `composer.json` gives `outDir` (here `App\Generated\Notes`). Then generate:

```sh
vendor/bin/seampact generate
# or
php artisan seampact:generate
```

When the generated code comes from another seampact version, every other command refuses to boot; `php artisan seampact:generate` still runs.

Commit the generated files ([Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files)). `seampact check` fails CI when they drift from the contract; [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how to run it.

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
