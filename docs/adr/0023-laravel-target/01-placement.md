### Placement

The developer writes controllers implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`) and binds each interface in the container. Each method takes the operation's generated FormRequest:

```php
final class TasksController implements TasksEndpoints
{
    public function updateTask(UpdateTaskRequest $request): UpdateTaskResult { ... }
}
```

Codegen emits, per api, under the target entry's `out`, in its PSR-4 namespace:

- **Per operation**:
  - the FormRequest (`UpdateTaskRequest`, in the root namespace), which runs steps 6 to 8 and hands over the typed input with `contractInput()`;
  - on the FormRequest, who is calling (ADR 0012 "Open tenancy"), read from the api's boundary state and never from the wire input: `principal()` on a route with an identity, the generated `<Identity>Principal` built from the declared members (null for an anonymous caller on an optional-auth route), and `scopes()` on a scoped route, the generated `<Operation>Scopes` with one accessor per scope returning its `ResolvedScope`; a dump of the boundary state prints both as `[redacted]`;
  - the input class, the result classes and one exception class per code. The input holds the path, query and header parameters and the body; the credential and CSRF headers, which the boundary reads, are not in it.
- **The boundary middleware** (`TasksBoundary`), a global middleware prepended before every other one, `ValidatePathEncoding` and `TrustProxies` included (spike); only the boundaries of the app's other apis, which pass every request outside their own base paths on unchanged, may come before it, and none whose base path equals or prefixes one of this api's with its `catch_all` on, since that boundary answers its 404 on this api's paths. It runs step 1:
  - the request context;
  - the raw-path match of "Routes" below;
  - the media type;
  - the bounded body read and the decoding;
  - the outgoing response check.
  It answers its own refusals in the api's format. On the first request of each booted application, which under php-fpm is every request, it checks that it is the first entry of the kernel's global middleware. When it is not, it answers the api's 500 and logs the fix on every request, so a route-cached serve, which skips the boot check, still keeps "boundary first".
- **The access middleware** (`TasksAccessMiddleware`), on every contract route and added to the priority list before `SubstituteBindings`. It runs steps 2 to 5: authenticate, principal requirements, scopes and requirements. It first checks that the route Laravel chose carries the operation that the raw path matched ("Routes"). Once steps 2 to 5 admit the request, it marks the request with that operation id, in a request attribute under a generated name.
- **The registration**: one service provider per api (`TasksSeampactServiceProvider`), which the app lists in `bootstrap/providers.php`. It:
  - prepends the boundary middleware and places the access middleware, through the HTTP kernel;
  - registers the routes macro, or loads nothing under `routes: file`;
  - merges and publishes the config of "Options and registration";
  - excludes contract routes from `TrimStrings` and `ConvertEmptyStringsToNull` (`skipWhen`);
  - runs the boot check;
  - refuses Octane at worker start ("Refused by name or waiting").

Both middleware are registered from the provider, with no edit to `bootstrap/app.php` (spike). The routes point at the interface (`[TasksEndpoints::class, 'updateTask']`), which the container resolves to the bound controller, cached routes included (spike). Each route is named `seampact.<api>.<operationId>`.

The generated types go into the PSR-4 namespace `composer.json` gives the entry's output directory, which the runner derives (ADR 0010 "Namespaces"), so no option names it; the schema types go into its `Schemas` sub-namespace. The FormRequests (`UpdateTaskRequest`) sit in that root namespace, beside the operation's input, result and errors; a name taken twice there is refused as `name.collision`. The rest of the Laravel placement (the provider, the middleware, the routes, the boundary, the contract and the urls) goes into the `Laravel` sub-namespace, with the api's `UnexpectedErrorListener` interface; no runtime is generated: the code imports it from the installed packages (ADR 0025). A declared schema `UpdateTask` and a placement class never share a namespace. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name, and constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: an interface implemented by one final class per declared success status and by the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, declared with `@throws` on the interface method (ADR 0012 "Errors the handler answers"). A decide hook that throws Laravel's `AuthorizationException` (`Gate::authorize()`) answers the requirement's first declared denial code, or the operation's `notFound` code for a route requirement's `Response::denyAsNotFound()` when the operation declares one. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").
