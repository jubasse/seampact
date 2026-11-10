### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"), refused by name until a consumer needs it ("Refused by name or waiting"):

- the target generates no hook interfaces and no steps 2 to 5; the `kernel.controller` listener keeps its fail-closed checks and steps 6 to 8;
- it exports the `TasksAccess` table and the per-kind request matchers above, for the app's `access_control` and voters (`#[IsGranted]` on a contract method stays refused by the boot check);
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.
