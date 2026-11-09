### Restricted fields

- On output, a field whose right the caller lacks is absent, never null. On a public route it is always absent unless its right is guest-enabled (FR-23).
- On input, a restricted field sent without the right is refused with 403 and the field pointer by default, or stripped; the policy is set per api in the conventions and may be overridden per field (A21).
- The boundary asks the decide hook with the field purpose and the subject derived from the right's declaration (ADR 0003 section 6): the route's resolved scope for a scope right; for a resource right, the holder's id property on output and the route's default subject on input and for sort keys. On output it also passes the holder object as the loaded record. It never walks schemas at run time: the IR lists each operation's field rights with their subject source (FR-23).
- An output field whose subject cannot be found on a route (a scope right on a route outside that scope) is always absent there, without a decide call (ADR 0003 section 6).
- A relay route has no field rights (ADR 0002 section 7): the service app sends every field and asks no decider about a member's right, and the public operation, in the gateway, projects the output and checks the input for its own caller.
