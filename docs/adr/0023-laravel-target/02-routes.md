### Routes

Patterns use Laravel's syntax, each placeholder named after its input property (`/v1/tasks/{taskId}`), so `route()`, `$request->route('taskId')` and `Route::bind()` work by name; `Route::bind()` needs `SubstituteBindings`, which routes registered in `withRouting(then:)` do not run, so the app adds it to `middleware.<kind>`. A name longer than the 32 characters of Symfony's route compiler, which Laravel uses, keeps a positional name (`{p2}` for the second placeholder). Each placeholder is pinned to one whole segment (`where('<name>', '[^/]++')`, Symfony's default requirement), so an app's global `Route::pattern()` never narrows a contract route. The boundary still matches the raw path. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `?` (`path.segment.literal.unsupported`);
- a static segment a client sends percent-encoded, one holding a space, a control or non-ASCII byte, `"`, `<`, `>`, `^`, `` ` ``, `\`, `{`, `}`, `|`, `[` or `]` (`path.segment.encoded.unsupported`), since the boundary answers such a raw path 404 ("Routes"), until a consumer needs one;
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Fastify, Hono and Spring.

Laravel matches routes in registration order, so the generated registration registers, per path depth, literal segments before placeholders: `/v1/tasks/search` before `/v1/tasks/{taskId}`.

The boundary middleware matches the raw request target against the contract templates. The raw target is `REQUEST_URI` without the query, minus the front controller's base path, computed from the server variables and stripped as a raw prefix (spike, CLI server). It never uses forwarded headers: the boundary runs before `TrustProxies`, and under Octane the trusted proxies an earlier request set would add `X-Forwarded-Prefix` to `getBaseUrl()`. The access middleware then compares the operation of the route Laravel chose with that match. Laravel decodes the path before routing, so the two can differ:

- `/v1/tasks/%73earch` reaches the search route while the raw path matches `{taskId}`. The access middleware answers the path's `notFound` 404 before any check (spike).
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the boundary, before routing, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash (which Laravel would trim and route), `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, and a segment holding a `;` path parameter (`7;x=1`), as on Spring (ADR 0022 "Routes"). The spike's reduced boundary answered the first three cases this way; it had no rule for `%2e%2e` and `;`, which Laravel routes to `{taskId}` as values.
- `a%2Fb` in a segment matches `{taskId}` raw, but Laravel routes the decoded `a/b` and finds no route, or the app's `Route::fallback()` answers it (200, no exception). On the way back, and only once routing ran (the router matched a route or raised its not-found exception), the boundary reads the route Laravel chose (`$request->route()`): a reply Laravel gives before routing (a bad encoding 400, a 413, a 503, a CORS preflight) keeps its own status. When the chosen route is not the contract route of the operation that the raw path matched (no route, an app route, the fallback or another contract route), the boundary answers that path's `notFound` 404, whatever the reply.
- A segment whose percent-decoding is not UTF-8 (`%E0%A4%A`) is refused by Laravel's `ValidatePathEncoding` with a `MalformedUrlException` (spike). The boundary answers it as ADR 0016 answers a path value that does not decode, the `schemaInvalid` 400 with that parameter's issue, without running steps 2 to 5.
- `catchAll: false` leaves those paths to the app. A base path shared with another api of the app is left to the app.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and Symfony's `Response::prepare()` drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the boundary, where Laravel would answer 405 with `Allow`, or 200 for `OPTIONS` (spike).
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's `HandleCors`, which runs after the boundary in the global stack.

`mount` is the prefix the generated route table writes before each contract path; the app wraps the macro in no group prefix.

Beside the route table, the shared `RouteHelpers` of `php/codegen` writes `<Api>RouteNames`, one constant per operation holding its route name, and `<Api>Urls`, one static method per operation taking one typed argument per path parameter in path order and returning the contract path, each value written as one segment by `WireValues::pathSegment` (its wire text, a number as JavaScript writes it, `encodeURIComponent`-encoded as the generated clients send it; an empty, `.`, `..` or non-UTF-8 value refused) and each static segment as the contract writes it, never prefixed (the boot check refuses a prefix while `mount` waits) and never absolute; `artefacts.routeHelpers: false` leaves both out.
