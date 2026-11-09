### The boot check

Before any other check, the contract class's `GENERATED_BY`, the full version of the generator that wrote it, is compared with the installed runtime's `RuntimeVersion::VERSION` (ADR 0025 "Version guards", G3): another `major.minor` or a lower patch refuses the boot as `runtime.generated-for-other-version`, with the fix to regenerate or install the runtime at the generator's version. While `php artisan seampact:generate` runs, read from the command line at each boot and never cached, the version check alone steps aside so the command that fixes the mismatch can run; every other boot, the next one included, refuses again.

The boot check runs in an `$app->booted()` callback of the provider. It runs:

- on an HTTP boot while the routes are not cached, so per request under php-fpm without a route cache. Measured in laravel-2 on the consumer's core operations (10 routes, PHP 8.5, OPcache on): about 0.05 ms per check, lost in the noise of a request's boot of about 10 ms;
- in `route:cache` and `optimize`, in the fresh application they boot after clearing the cache, so a failing check writes no cache file (spike).

It does not run on other artisan commands, so `migrate` and `tinker` work on a broken app, and it does not run on an HTTP boot that reads a route cache, whose routes `route:cache` already checked. It lists every problem at once with the operation id, the name and the fix, and throws, so the app does not serve:

- the hook problems of ADR 0016's list, read from the container's bindings;
- a contract operation without a bound handler (its interface unbound in the container), without a contract route, or with two (the macro called twice);
- an app route registered before a contract route with the same method and URI, which Laravel would match first; other overlaps are left to the run-time 404 of "Routes", which answers when the route Laravel chose is not the raw-matched operation's;
- a route that no generated registration made and that `frameworkRoutes` does not allow-list (FR-25), an app `Route::fallback()` included. The check skips Laravel's own routes, each matched by what Laravel registers, never by path:
  - the health route (`/up` by default), by its action `Illuminate\Foundation\Http\HealthCheck`, since Laravel gives it no name;
  - the routes of a disk served locally (`storage/{path}`), by their names `storage.<disk>` and `storage.<disk>.upload` together with their action, Laravel's local file-serving controller;
  - Sanctum's CSRF cookie route, by its name `sanctum.csrf-cookie`, proved by laravel-4's Sanctum row;
- a route that no generated registration made whose action is a contract interface's method or a method of a class bound to one, whatever `frameworkRoutes` allow-lists and whether that check is on; at run time the FormRequest refuses such a request anyway ("Types and validation");
- a contract route whose URI differs from `mount` followed by the contract path, as when the app wraps the macro in a group prefix that `mount` does not name;
- the boundary middleware not first in the global stack, the access middleware not before `SubstituteBindings` in the priority list, or a contract route without it (`withoutMiddleware`);
- a `public_origin` set under relative URLs, a missing or malformed one under absolute URLs, or ext-zlib not loaded;
- a Laravel major other than 13, read from `Application::VERSION`; `generate` already refuses older majors from the Composer lock.

`artefacts.bootCheck: false` turns the whole check off; `{ frameworkRoutes: false }` turns the framework-route check off and `{ hooks: off }` the hook check, as on spring-boot (ADR 0011). `{ hooks: warn }` waits for an app that needs it. The handler check runs whenever the boot check does.
