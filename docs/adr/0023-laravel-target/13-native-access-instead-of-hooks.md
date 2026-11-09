### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"), refused by name until a consumer needs it ("Refused by name or waiting"):

- the target generates no hook interfaces and no steps 2 to 5; the access middleware keeps its route check and marks the request, so the FormRequest still runs only behind it;
- it exports the `TasksAccess` table and the per-kind middleware lists above, for the app's `can` middleware and Policies;
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.
