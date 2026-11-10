### One neutral, typed hook per concern

Every server target generates exactly three hook interfaces (FR-25), unless the app turns `accessHooks` off for native access (below). Each is typed from the contract: the generated request types name the identity, right, rule or scope and carry its declared params, principal and error codes.

**Authenticate**, one per identity. It receives:
- the identity name and the credentials found in the locations the identity's schemes declare for this request (read or write schemes), including the CSRF companion value on a write through a cookie scheme that declares `csrf` (opt-in, [A34](../../decisions.md#a34)); on a write that accepts a cookie and a bearer scheme, the derived `csrf` check applies to the requests authenticated by the cookie only. The boundary refuses such a write that carries only cookie credentials and whose CSRF header is absent or empty with the derived `csrfInvalid` code (403), before the hook runs; the hook still checks the value;
- for a signed identity, the raw body and the parsed signature fields (ADR 0013), or, for a scheme with `verify: application`, the raw body, the signature header and the scheme's declared headers, unparsed (ADR 0002 section 9, [A40](../../decisions.md#a40));
- a read-only view of the request (method, path, headers, client address) and the operation reference;
- the operation's extension metadata (A20).

It answers a typed principal (tagged with its variant when the identity declares several, FR-27) or a denial limited to the identity's declared codes. The hook is not called when no declared credential is present: the boundary answers 401, or continues with a null principal on a public or optional-auth route. A refused credential on an optional-auth route is treated as anonymous (FR-4), or answers 401 when the route says `onRefused: reject` (A40). The boundary validates the returned principal against the principal schema; an invalid principal is a server error (500), never accepted. The principal reaches later hooks and the handler as its schema declares: members the schema does not declare are dropped, like undeclared output fields.

**Decide**, for every requirement, right or rule. It receives:
- the kind (right or rule), the name and the typed params declared at the use site;
- the principal, or null for an anonymous caller on a public or optional-auth route: always possible for a rule, and for a right only when it is guest-enabled, since a non-guest right on such a route is a compile error (FR-22, SCN-036, SCN-063);
- the subject reference, when the right has one: the subject type and the id taken from its declared source, checked against its schema first when that source is the request; plus the loaded record when the application registers a loader for that resource type, in which case the handler receives the same record;
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
