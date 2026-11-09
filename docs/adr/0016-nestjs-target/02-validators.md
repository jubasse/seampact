### Validators

The target reads both validator styles of ADR 0009: `standard-schema` (zod, yup) and `class-validator`, the one target that accepts the latter. In both styles every export of the descriptor is a Standard Schema v1 value, in `class-validator` an adapter over a decorated DTO class, so the route table and the guard read both alike and step 6 stays one call.

- With `class-validator`, the provider generates the decorated DTOs and the adapter validates with strict options: unknown keys refused (`whitelist` with `forbidNonWhitelisted`), no implicit conversion (`transform` with `enableImplicitConversion: false`, a value coerced only where the contract's wire rules decode it), and every issue reported.
- These options apply inside the seampact input pipe's step 6, not in a `UsePipes` pipe of the app: the request is validated once, its refusal is the contract's `schemaInvalid` error with the same `{ in, pointer, rule }` issues as the Standard Schema path, and the app's own `ValidationPipe`, which runs before it, never changes the contract input.
- Any other validator style is refused by the link check (`link.style.unsupported`), naming the first-party packages of both accepted styles.
