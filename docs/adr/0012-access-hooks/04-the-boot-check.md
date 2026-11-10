### The boot check

The app config's `artefacts.bootCheck.hooks` sets the level for missing hooks: `error` refuses to start, `warn` logs them and starts, `off` starts silently, and a route whose hook is missing then answers 500; a right claimed by two deciders refuses to start at every level.

Before the application accepts a request, the generated boot check refuses to start, listing every problem at once with the operation id, the name and the fix, when:
- an identity used by a bound operation has no authenticate hook;
- a right or rule used by a bound operation has no decider;
- a scope used by a bound operation has no resolver;
- a contract operation has no bound handler, among the operations the target entry's `operations` filter keeps (ADR 0011);
- a framework route is absent from the generated route table and not allow-listed with a reason in the app config, by its path or a path pattern (`/actuator/**`, ADR 0011), apart from the routes of the framework's own document while it is on, which the target reads from the framework's configuration and reports (ADR 0011);
- the framework adds a path prefix of its own to the contract routes (a NestJS global prefix, a Laravel route group, a Hono base path, an Express mount path); the contract routes are registered under the target entry's `mount` (ADR 0011), which is where such a prefix is written;
- a decider's params check refuses the params of a requirement;
- the installed hooks package is outside the range the generated code needs.

Node targets that cannot read a setting at boot check it on the request instead and answer 500 with the fix logged (ADR 0016, ADR 0019).

By default the framework-route check looks only at the app routes that can serve a path at or under one of the api's mounted base paths, so an app's routes beside the api are its own; `artefacts.bootCheck.frameworkRoutes: strict` checks every app route, and an api with no base path and no mount is always checked whole. The scope fails closed: a route segment with any route syntax reads as a param, and as a catch-all when its pattern may take a `/` or cannot be read (`/:rest{.+}`, `/api{rest}` with `.+`); a route written as a regular expression is always checked; on Node and Spring a literal segment compares without case, as Express and a case-insensitive parser match it. The framework-route check lists the routes the framework registers when the check runs; a route added after it is not seen, and middleware that answers requests is not a route, so neither is listed. A route is the contract's when the generated code registered it, never because its path equals a contract path.

In PHP, where an application boots per request, the check runs when the container or route cache is built and at boot when no cache exists; the generated dispatcher also answers 500 rather than call a missing hook.

The app config may switch off the framework-route check and the hook check apart (`artefacts.bootCheck: { frameworkRoutes: false, hooks: off }`), for an app that registers many routes of its own, or that sets the hook level above; an app that serves part of an api filters its entry's operations instead, since the handler check runs whenever the boot check does. While the target generates hooks, a route whose hook is missing still answers 500, since nothing may fall back to allow. `artefacts.bootCheck` has two switches, `{ frameworkRoutes, hooks }`; the handler check runs whenever the boot check does and has none. `hooks: warn` is accepted by the Node servers and refused by name (`artefacts.bootCheck.hooks.warn.unsupported`) on Spring Boot, Laravel, Symfony, FastAPI, Django REST framework and Django Ninja. A mount mismatch (a framework adding a prefix the entry's `mount` does not state) fails the boot on Spring Boot, Laravel, Symfony, FastAPI, Django REST framework, Django Ninja, NestJS, Fastify and Hono, and is refused at the first request on Express and AdonisJS.
