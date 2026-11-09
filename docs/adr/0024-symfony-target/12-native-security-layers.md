### Native security layers

Symfony's firewall, `access_control` and voters stay the app's. The target exports each operation's access in Symfony's native form (ADR 0012 "Native security layers"):

- the route names `seampact.<api>.<operationId>`;
- one request matcher service per access kind (`seampact.tasks.matcher.public`, `optional`, `identity`, `signed`), implementing `RequestMatcherInterface`; it runs step 1's raw-path match itself, not reading step 1's request attribute, so a public template `/v1/things/{id}` never covers its identity sibling `/v1/things/mine`, and a path no operation serves matches no kind. Each is a `KindRequestMatcher` of `Seampact\Symfony\Runtime`, so it answers the same in a firewall's `request_matcher`, in `access_control` and in an app listener; an identity verified by a signature is the `signed` kind, as on Laravel, read through the shared `AccessKind` of `php/codegen`. The app uses them in `access_control` (`request_matcher:`) and in a firewall's `request_matcher`; the matcher reads no result of step 1, so it works at whatever point the firewall evaluates it;
- a generated `TasksAccess` table, a constant `ROUTES` keyed by route name, giving each operation's id, access kind, identity (null on a public route), the rights and rules it requires, by name, and the scopes it resolves; `KINDS` lists the four kinds.

Their refusals are mapped to roles as "Exceptions on contract routes" says. Symfony has no global CSRF check on JSON routes. A contract route's CSRF check is the authenticate hook's, with the CSRF companion value, and an `InvalidCsrfTokenException` that an app's authenticator throws answers `csrfInvalid`; `#[IsCsrfTokenValid]` and `#[IsGranted]` on a contract method are refused by the boot check.

Symfony answers the hooks as application code, with no adapter package in 1.0 (ADR 0012 "Optional adapters"). The runtime ships one opt-in decider, `VoterDecider`, that an app turns on by tagging it `seampact.<api>.deciders`: it answers a right by `isGranted(name, $request)`, so voters decide, and a denial still answers the operation's first declared code:

- an authenticate hook reads the user from the token storage (`Security::getUser()`); the `kernel.controller` listener runs after the firewall, so the user is set (spike);
- a decider calls `isGranted` with the right name and a subject object carrying params and scopes, which the app's voters decide; the `AccessDeniedException` of `denyAccessUnlessGranted()` answers the first declared denial code;
- on an optional-auth route with `onRefused: anonymous`, the app's firewall is `lazy` with no `access_control` rule on the `optional` matcher, and the hook answers anonymous when the token storage has no user.
