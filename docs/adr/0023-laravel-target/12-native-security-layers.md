### Native security layers

Laravel's layers stay the app's, on the routes the app chooses. The target exports each operation's access in Laravel's native form (ADR 0012 "Native security layers"):

- the route names `seampact.<api>.<operationId>`;
- the `config('seampact.<api>.middleware.<kind>')` lists, which put the app's own middleware (`auth:sanctum` on `identity`) on exactly the routes of one access kind, so a public template `/v1/things/{id}` never shares the middleware of its identity sibling `/v1/things/mine`;
- a generated `TasksAccess` table, keyed by route name, giving each operation's access kind, identity, requirements and scopes.

Their refusals are mapped to roles as "Exceptions on contract routes" says. Without `Sec-Fetch-Site: same-origin` or a token, the `web` group's `PreventRequestForgery` refuses an unsafe method on a route with a cookie credential, answered as `csrfInvalid` (spike); a route without one never runs it. An API-only app needs no `login` route: on a contract request the boundary skips the guest redirect, which would otherwise throw `RouteNotFoundException` while `Authenticate` or `auth.session`'s `AuthenticateSession` builds its own exception (spike), and keeps the app's `redirectGuestsTo()` on its own routes.

Laravel answers the hooks as application code, with no adapter package in 1.0 except `seampact/laravel-spatie` later (ADR 0012 "Optional adapters"). The runtime ships one opt-in decider, `GateDecider`, that an app turns on by tagging it: it answers a right by `Gate::authorize` with the subject and the other scope values, so Policies decide, and a denial still answers the operation's first declared code (`denyAsNotFound` answers `notFound`):

- an authenticate hook reads the user from the configured guard (`Auth::guard('sanctum')->user()`); the access middleware runs after the session, so session guards work;
- a decider asks the Gate for the principal (`Gate::forUser($user)->authorize('update', $task)`), and the `AuthorizationException` it throws answers the first declared denial code;
- on an optional-auth route with `onRefused: anonymous`, the app leaves `auth` off the `optional` kind, and the hook answers anonymous when the guard has no user.
