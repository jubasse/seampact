### Routes

Patterns use Symfony's syntax, each placeholder named after its input property (`/v1/tasks/{taskId}`), so the router builds a URL by name; a name longer than the 32 characters of the route compiler keeps a positional name (`{p2}` for the second placeholder), as on Laravel. The boundary still matches the raw path. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `?` (`path.segment.literal.unsupported`);
- a static segment a client sends percent-encoded, one holding a space, a control or non-ASCII byte, `"`, `<`, `>`, `^`, `` ` ``, `\`, `{`, `}`, `|`, `[` or `]` (`path.segment.encoded.unsupported`), since the boundary answers such a raw path 404 ("Routes"), until a consumer needs one;
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Laravel, Spring and the Node targets.

The router matches routes in registration order, so the loader registers, per path depth, literal segments before placeholders: `/v1/tasks/search` before `/v1/tasks/{taskId}` (spike). The app imports the routes from its own routing configuration, once per api, with the api name as the resource:

```yaml
# config/routes/seampact.yaml
seampact_tasks:
    resource: tasks
    type: seampact
```

Each api's loader supports the `seampact` type for its own api name only, so two apis load apart. The loader writes each contract path under the entry's `mount`, and the routing import takes no `prefix`: the boot check refuses a contract route whose path is not the mount followed by the contract path, and an import `host`, `schemes` or `condition` on a contract route too. The runner passes `frameworkRoutes` to the generator through the target entry.

The `kernel.request` listener matches the raw path, `getPathInfo()`, against the contract templates. That path is the request target without the query, minus the front controller's own base path; a trusted `X-Forwarded-Prefix` does not change it (spike). The `kernel.controller` listener then compares the operation of the route the router chose with that match. The router decodes the path before matching, so the two can differ:

- `/v1/tasks/%73earch` reaches the search route while the raw path matches `{taskId}`. The listener answers the path's `notFound` 404 before any check (spike).
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the `kernel.request` listener, before routing, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash, which the router would redirect, `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, a segment holding a `;` path parameter (`7;x=1`), and an app route under the base path that the contract does not declare (spike).
- `a%2Fb` in a segment matches `{taskId}` raw, but the router matches the decoded `a/b` and finds no route, or an app route. On the way back, and only once routing ran (the marker after `RouterListener` is set, or the router raised its not-found or method-not-allowed exception), the `kernel.response` listener reads the chosen route (`_route`). When it is not the contract route of the operation that the raw path matched, the listener answers that path's `notFound` 404, whatever the reply (spike). A reply given before routing (the boundary's own, a `ValidateRequestListener` 400) keeps its status.
- A segment whose percent-decoding is not UTF-8 (`%E0%A4%A`) is answered by the `kernel.request` listener as ADR 0016 answers a path value that does not decode: the `schemaInvalid` 400 with that parameter's issue, without running steps 2 to 5 (spike).
- `catchAll: false` leaves those paths to the app. The boot check refuses an api when another api's bundle, listed before it, has `catchAll` on and a base path that is empty, equal to or a prefix of this api's, since that api's 404 would answer this api's paths; set `catchAll: false` on the earlier api.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and `Response::prepare()` drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the `kernel.request` listener, where the router would answer 405 (spike).
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's CORS listener, such as NelmioCorsBundle's, which runs after the boundary.

Beside the route loader, the shared `RouteHelpers` of `php/codegen` writes `<Api>RouteNames`, one constant per operation holding its route name, and `<Api>Urls`, one static method per operation taking one typed argument per path parameter in path order and returning the contract path, each value written as one segment by `WireValues::pathSegment` (its wire text, a number as JavaScript writes it, `encodeURIComponent`-encoded as the generated clients send it; an empty, `.`, `..` or non-UTF-8 value refused) and each static segment as the contract writes it, never prefixed (the boot check refuses a prefix while `mount` waits) and never absolute; `artefacts.routeHelpers: false` leaves both out.
