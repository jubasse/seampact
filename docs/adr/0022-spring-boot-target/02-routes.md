### Routes

Patterns use `PathPatternParser` syntax with positional variable names (`/v1/tasks/{p1}`), which the boundary never reads. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `*` (`path.segment.literal.unsupported`);
- a static segment a client sends percent-encoded, one holding a space, a control or non-ASCII character, `"`, `<`, `>`, `^`, `` ` ``, `\`, `{`, `}`, `|`, `[` or `]` (`path.segment.encoded.unsupported`), since the filter's raw-path match below answers such a path 404, as on Laravel, Symfony and the Node targets;
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Fastify and Hono.

Spring orders patterns by specificity, so `/v1/tasks/search` wins over `/v1/tasks/{p1}` whatever the declaration order.

The filter matches the raw request target against the contract templates: `getRequestURI()` without the request's own `getContextPath()`, read on each request, then without the servlet path, stripped as a raw prefix, never through the decoded `getServletPath()`. Behind a proxy, `ForwardedHeaderFilter` applies `X-Forwarded-Prefix` to the context path of each request, so routing stays right. The boot check compares a configured `mount` with the configured paths; without one, an app under a context path or a servlet path starts, since the filter strips both from each request. The interceptor then compares the operation of the handler method Spring chose with that match. Tomcat decodes and normalizes the path before routing, so the two can differ:

- `/v1/tasks/%73earch` reaches the `search` method while the raw path matches `{p1}`. The interceptor answers the path's `notFound` 404 before any check, as on Hono.
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the filter, before Spring Security, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash, `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, and a segment holding a `;` path parameter, which Tomcat strips before routing.
- When no operation of the api has the `notFound` role, those paths answer a bare 404 with no body, as on the Node targets, never the app.
- `catchAll: false` leaves those paths to the app. A base path shared with another api of the app is left to the app.
- `%2F` in a segment, a `\`, and a malformed percent-encoding never reach a filter: Tomcat answers its own 400 page. These are outside the boundary and listed in Consequences. The docs tell users not to loosen the Tomcat connector's `relaxedPathChars` and `encodedSolidusHandling`, which change what reaches the raw-path match.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and Tomcat drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the filter, where Spring would answer 405 with `Allow`, or 200 for `OPTIONS`.
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's own CORS setup, which Spring answers (spike).
