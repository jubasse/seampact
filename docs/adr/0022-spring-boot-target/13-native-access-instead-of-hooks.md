### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"):

- the target generates no hook interfaces and no steps 2 to 5;
- it exports each operation's identity, requirements and scopes as a generated `TasksAccess` table keyed by the matchers above, for the app's `AuthorizationManager`;
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.
