### Optional adapters

An adapter is a separate package that implements one or more hooks with a library (ADR 0009). No target depends on one, and every target passes the HTTP suite with hand-written hooks and no adapter installed (CHK-098). Each adapter has its own conformance tests, including the rights and scope cases of the HTTP suite.

1.0 ships two (A24):
- `@seampact/nestjs-casl` answers the decide hook with CASL: an application-supplied factory builds the ability for the principal; a right maps to an action and subject type, by a configurable table that defaults to splitting `<resource>.<action>` names; the check uses the loaded record when a loader is registered; field rights use `permittedFieldsOf`.
- `seampact/laravel-spatie` answers the decide hook through Laravel's Gate, with spatie permissions named after the rights by default (configurable), and sets the permission team from the resolved scope before each decision.

Other libraries plug in through the same hooks, as application code or community adapters, without replacing the library's own mechanism:

| Library | Hook | How |
|---|---|---|
| Clerk | authenticate | verify the session token with Clerk's backend SDK and build the principal from the claims |
| better-auth | authenticate | read the session from the request headers through better-auth's server API |
| Passport | authenticate | run the strategy inside the hook, or keep Passport's guard or middleware and read the user it set; a global Passport guard reads the operation's access kind from the route metadata (below) and lets public and optional-auth routes through |
| Laravel guards and Sanctum | authenticate | read the user from the configured guard |
| Laravel Gates and Policies | decide | ask the Gate for the principal, passing the subject and params |
| Symfony Security and Voters | authenticate, decide | read the user from the token storage after the firewall; call `isGranted` with the right name and a subject object carrying params and scopes |
| Spring Security | authenticate, decide | read the `Authentication` set by the filter chain; delegate to a `PermissionEvaluator` or an `AuthorizationManager` bean. On an optional-auth route with `onRefused: anonymous`, the resource server's bearer filter must not answer 401 itself: exclude those routes with the generated request matchers (below), or verify the token inside the authenticate hook |
