### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only: `perOperation`, one interface per operation for an `__invoke` controller, waits for an app that needs it (`options.handlers.unsupported`);
- `indent`;
- `routes` (`macro`, the default, or `file`);
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 (`suffixes`, `escape`, `enumCase`) are refused by name (`options.naming.unsupported`): the target names PHP with the ADR 0007 defaults, which the shared naming vectors test. `layout` is refused too (`options.layout.unsupported`): one file per class under the PSR-4 directory is the only layout Composer loads.

Under `routes: macro`, the app calls `Route::seampact('tasks');` outside any route prefix, from `withRouting(then:)` or from `routes/api.php` with `apiPrefix: ''`. The macro is defined once, whichever api's provider boots first, and looks up the api's generated route table in the container, so two apis share it. Under `routes: file`, the generator writes `routes.php` in the api's directory, one `Route::` line per operation, which the app requires from its own routes file. Both forms register the same routes, survive `route:cache` (spike, macro form) and exclude `PreventRequestForgery` from every route that reads no cookie credential (a bearer, header or signed caller, or a public route), whose caller cannot hold a CSRF token (ADR 0013); a route with a cookie credential keeps it inside the `web` group, and the boundary still checks the contract's CSRF header for a cookie-only caller.

At run time, the generated code reads `config('seampact.<api>.*')`:

- `responses` and `body_validation` for the api;
- `operations.<operationId>.responses` per operation;
- `public_origin`;
- `middleware.<kind>`: the route middleware the registration adds to the routes of each access kind (`public`, `optional`, `identity`, `signed`), empty by default, for the app's own native layers ("Native security layers").

An operation's value wins over the api's value, which wins over the target option. The provider merges, below the app's own `config('seampact.<api>')`, the generated settings file and then the generated defaults, as `mergeConfigFrom()` does, so `SEAMPACT_<API>_*` variables apply before the file is published; it publishes that file as `config/seampact/<api>.php` (`php artisan vendor:publish --tag=seampact-config`), one file per api so two apis never claim one file, whose values call `env()` (`SEAMPACT_TASKS_RESPONSES`) and fall back to the generated route table's `DEFAULTS`, so a regenerate with other options still reaches a file published earlier. The middleware lists are read when the routes are registered, so a route cache keeps the lists it was built with. Only that settings file calls `env()`, which `config:cache` reads once, so a cache built at container start keeps the values (spike).

Hooks are container bindings: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact/hooks` interfaces, narrowed by the generated request classes, and `onUnexpectedError` is an optional binding of the api's generated `Laravel\UnexpectedErrorListener` interface, which extends the runtime's, so the lookup is keyed per api and two apis never share one binding or receive each other's failures; one bound to another type is refused by name and logged, and the api's 500 still goes out. The provider resolves them per request, never in a constructor of a long-lived object. A decider names the rights and rules it serves; two claiming one name fail the boot check, no default hook exists, and a missing hook answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, is a request attribute under a generated name (ADR 0012 "Open tenancy").

Two apis are two providers, each with its own middleware, route table and boot check.
