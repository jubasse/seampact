# ADR 0012: Neutral access hooks

Status: accepted

## Context

Authentication, rights, roles and tenancy are unopinionated, even at the cost of less generated code (amendment A25). The contract declares what a route requires: an identity and its principal schema, requirements (rights and rules) with typed params and a subject, tenancy scopes, and the errors each can raise. It never says how a credential is checked, how a right is decided or how a tenant is found. Applications keep the libraries they already use: Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates and Policies, Symfony Voters, Spring Security, or hand-written code (A25). seampact adapts to the framework's own mechanisms and never replaces them (A30).

The rights research (`.work/rights-research.md`) proposed mapping each right onto each framework's native authorization mechanism inside the target. A25 overrides that: targets generate neutral hooks only, and native mappings are optional adapter packages. Rights stay flexible (A20), a restricted input field is rejected or stripped by configuration (A21), and tenancy is open (A23). 1.0 ships the CASL and spatie adapters (A24).

Rights, rules, scopes and identities are declared with the grammar of ADR 0002 and recorded in the IR of ADR 0004. This ADR decides the runtime boundary every server target generates from them.

## Decisions

### One neutral, typed hook per concern

Every server target generates exactly three hook interfaces (FR-25). Each is typed from the contract: the generated request types name the identity, right, rule or scope and carry its declared params, principal and error codes.

**Authenticate**, one per identity. It receives:
- the identity name and the credentials found in the locations the identity's schemes declare for this request (read or write schemes), including the CSRF companion value on a cookie write;
- for a signed identity, the raw body and the parsed signature fields (ADR 0013);
- a read-only view of the request (method, path, headers, client address) and the operation reference;
- the operation's extension metadata (A20).

It answers a typed principal (tagged with its variant when the identity declares several, FR-27) or a denial limited to the identity's declared codes. The hook is not called when no declared credential is present: the boundary answers 401, or continues with a null principal on a public or optional-auth route. A refused credential on an optional-auth route is treated as anonymous (FR-4). The boundary validates the returned principal against the principal schema; an invalid principal is a server error (500), never accepted.

**Decide**, for every requirement, right or rule. It receives:
- the kind (right or rule), the name and the typed params declared at the use site;
- the principal, null only for a guest-enabled right on a public or optional-auth route (FR-22);
- the subject reference, when the right has one: the subject type and the id taken from its declared source; plus the loaded record when the application registers a loader for that resource type, in which case the handler receives the same record;
- the resolved scopes, outermost first;
- the rule's proof, when the rule declares one (FR-41), and for a throttle requirement the bucket with its key sources and limits;
- the purpose (route requirement, restricted field with its pointer and direction, or restricted sort key);
- the operation reference, a read-only request view and the extension metadata of the right or rule and of the operation (A20).

It answers allow, or a denial naming one of the declared codes with that code's typed params (for example a retry delay on a rate-limit reply). An optional batch form decides several requests at once, for restricted fields over a list; by default the boundary loops. Identical requests within one HTTP request are decided once.

**Resolve scope**, one per scope kind. It receives the scope name, the id from the declared source (path, query, header, host or subdomain, principal field), already decoded and validated against the scope's id schema, or, for a custom resolver, no id and the request view; plus the principal and the scopes resolved before it. It answers the resolved scope (its id and an optional application value carried untouched to later hooks and the handler) or one of the scope's declared membership denials.

The shape, in TypeScript, for illustration only (the generated names follow ADR 0007, and the generic types live in the hooks package of ADR 0009):

```ts
export interface DecideHook<R extends RequirementRequest> {
  decide(request: R): Decision<R['deniableCodes']> | Promise<Decision<R['deniableCodes']>>;
  decideMany?(requests: readonly R[]): Promise<readonly Decision<R['deniableCodes']>[]>;
}
export type Decision<C extends ErrorCodeWithParams> = { allow: true } | { deny: C };
```

### Registration and per-right overrides

Each target registers hooks through its framework's own mechanism (A30): providers and a dynamic module in NestJS, options of the generated plugin in Fastify, the router factory in Express, the IoC container in AdonisJS, beans in Spring, service-provider bindings in Laravel, tagged services in Symfony.

- An authenticate hook is bound per identity, or one implementation declares the identities it serves.
- A decider declares the right and rule names it answers, or declares that it answers all of them.
- An override binds one implementation to one right or rule name and wins over every other decider for that name (A20, CHK-091). The others keep using the generic decider.
- Two non-override deciders claiming the same name is a boot error.
- A scope resolver is bound per scope kind, or one implementation declares the kinds it serves.
- A decider may expose a boot-time params check, called once per requirement use with the static params from the contract, to refuse values it does not understand (an unknown role name, for example).

No target ships a default hook, and nothing falls back to allow.

### The boot check

Before the application accepts a request, the generated boot check refuses to start, listing every problem at once with the operation id, the name and the fix, when:
- an identity used by a bound operation has no authenticate hook;
- a right or rule used by a bound operation has no decider;
- a scope used by a bound operation has no resolver;
- a contract operation has no bound handler;
- a framework route is absent from the generated route table and not allow-listed with a reason in the consumer config (ADR 0011);
- a decider's params check refuses the params of a requirement;
- the installed hooks package is outside the range the generated code needs.

In PHP, where an application boots per request, the check runs when the container or route cache is built and at boot when no cache exists; the generated dispatcher also answers 500 rather than call a missing hook.

### The check order

The order is fixed in every target and stops at the first failure (FR-5):

1. Transport refusals raised while the framework parses: unknown route (404), body too large (413), unsupported media type (415), malformed body (400), rendered in the api's declared error format (ADR 0008).
2. Authenticate (401), over the raw body for a signed identity.
3. Principal requirements (403).
4. Scope resolution, outermost scope first (each scope's declared denial).
5. Requirements in declared order. A body proof is read from the parsed body and checked against its own field schema in this step.
6. Input validation (400), reporting every issue of path, query, headers and body at once.
7. Restricted input fields (403 with the field pointer, or stripped, per A21) and restricted sort keys (403).
8. Principal bindings (403).
9. The handler.
10. The response: an undeclared status answers 500; restricted output fields are projected out; undeclared fields are stripped; sensitive values are redacted from logs; the success or error format, cache, identity and deprecation headers are written.

Each target places the steps in its framework's mechanisms, in this order. In spring-boot, the steps that need no body run in a `HandlerInterceptor`; the generated delegating controller binds the body without validating it, runs the remaining requirement steps, then validates, then checks bindings (FR-19), so the observable order is the same as everywhere else.

### Restricted fields

- On output, a field whose right the caller lacks is absent, never null. On a public route it is always absent unless its right is guest-enabled (FR-23).
- On input, a restricted field sent without the right is refused with 403 and the field pointer by default, or stripped; the policy is set per api in the conventions and may be overridden per field (A21).
- The boundary asks the decide hook with the field purpose and the holder object as the subject record, and never walks schemas at run time: the IR lists each operation's field rights (FR-23).

### Open tenancy

A route runs in zero, one or several nested scopes (A23). Each scope id comes from a declared source or from a custom resolver; no resolution scheme, tenant model or storage is imposed. The resolved scopes reach every later hook and the handler through a request context built on the framework's own facility: `AsyncLocalStorage` in the Node targets, request attributes in Spring, Symfony and Laravel.

### Custom metadata

Extension values declared on rights, rules, scopes and operations (ADR 0008) reach the hook requests and the route metadata, typed from their JSON Schemas (A20). An application can, for example, attach an audit category to a right and read it in its decider.

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
| Passport | authenticate | run the strategy inside the hook, or keep Passport's guard or middleware and read the user it set |
| Laravel guards and Sanctum | authenticate | read the user from the configured guard |
| Laravel Gates and Policies | decide | ask the Gate for the principal, passing the subject and params |
| Symfony Security and Voters | authenticate, decide | read the user from the token storage after the firewall; call `isGranted` with the right name and a subject object carrying params and scopes |
| Spring Security | authenticate, decide | read the `Authentication` set by the filter chain; delegate to a `PermissionEvaluator` or an `AuthorizationManager` bean |

### Failures inside hooks

- A hook that throws or rejects produces 500 with the error logged; it never counts as allow.
- A denial naming a code the requirement did not declare produces 500: the contract would otherwise be broken silently.
- Timeouts and retries inside a hook are the application's concern.

## Consequences

- Each target generates less than a native mapping would (no `#[IsGranted]`, `@PreAuthorize` or policy registration), and the application or an adapter writes a few lines of glue. In return no target imposes a library, a right naming scheme or a tenancy scheme.
- The same HTTP suite proves every target, because every target exposes the same three hooks.
- The check order is a contract fact. A framework whose natural order differs (Spring's argument validation, NestJS guards before pipes) is adapted by the generated code, not by the application.
- The CASL and spatie adapters show how to write an adapter; community adapters follow the same hooks package.

## Traceability

- FRs: FR-4, FR-5, FR-19 (spring-boot check placement), FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-41, FR-10 (metadata reaches the boundary); amendments A18, A20, A21, A23, A24, A25, A30.
- Checklist items enabled: CHK-004, CHK-006, CHK-007 (identities, variants, CSRF), CHK-014 (order and boot refusal), CHK-015, CHK-016 (throttle bucket and proof reach the hook), CHK-017, CHK-018, CHK-019, CHK-020, CHK-025, CHK-033, CHK-062, CHK-063, CHK-086, CHK-087, CHK-090, CHK-091, CHK-092, CHK-093, CHK-094, CHK-096, CHK-097, CHK-098, CHK-099.
- Success metric: SM-8.
