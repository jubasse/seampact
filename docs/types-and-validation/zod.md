# zod

`@seampact/codegen-zod` writes a zod schema for each schema of your contract. NestJS, Express, Fastify, AdonisJS, Hono and Next.js use them to refuse a bad request before your handler runs.

Used by: [NestJS](../backend/nestjs.md) (the default), [Express](../backend/express.md), [Hono](../backend/hono.md), [Next.js](../backend/nextjs.md), [Fastify](../backend/fastify.md) and [AdonisJS](../backend/adonisjs.md), through the `validators` link.

## Set up

Add the target and link it from your server entry. Install `zod` (version 4) in your app.

```yaml
# seampact.config.yaml, under targets
  - id: validators
    use: "@seampact/codegen-zod"
    apis: [notes]
```

Link it from your server entry, next to `types`:

```yaml
    link:
      types: types
      validators: validators
```

Run `npx seampact generate`. The files land in `validators/<api>/` under your `outDir`.

## What you get

For the `CreateTask` schema of the [overview](README.md), the input schema refuses a key the contract does not declare. Trimmed from `schemas/input.ts`:

<!-- excerpt: packages/targets/codegen-zod/rules-snapshots/native/schemas/input.ts.snap -->
```ts
export const CreateTaskSchema = z.strictObject({
  title: z
    .string()
    .min(1, { error: "Expected at least 1 character." })
    .max(200, { error: "Expected at most 200 characters." }),
  effort: z.int().gte(0).optional(),
});
```

Each operation also gets one schema over its `path`, `query`, `headers` and `body`, in `operations/input.ts`:

<!-- excerpt: packages/targets/codegen-zod/rules-snapshots/native/operations/input.ts.snap -->
```ts
export const CreateTaskInputSchema = z.object({
  path: z.object({
    channelId: z.uuid({ error: "Expected a UUID: 8-4-4-4-12 hex digits." }),
  }),
  query: z.strictObject({}),
  headers: z.object({
    authorization: z.string().optional(),
    "x-csrf-token": z.string().optional(),
    "idempotency-key": z.string(),
  }),
  body: inputSchemas.CreateTaskSchema,
});
```

Output schemas strip a key they do not know, and an output enum accepts any string, so a server that adds a value does not break an older client. An input enum is closed.

## Use them in your code

Import from the api's `index.ts`: `inputSchemas`, `outputSchemas` and one `<Operation>InputSchema` per operation.

```ts
import { inputSchemas } from "./__generated__/validators/notes/index.js";

const result = inputSchemas.CreateTaskSchema.safeParse({ title: "" });
```

The server calls them for you. You only call them to check a value of your own.

## When a check fails

Every zod issue becomes one issue of the [400 body](README.md#when-a-check-fails), named by the contract rule: `invalid_type` becomes `required` (the value is absent) or `type`, `too_small` and `too_big` become `minLength`, `minimum` and the like, `invalid_format` becomes `format`, `invalid_value` becomes `enum`, and an unknown key becomes `unknownKeys`.

## Native or consistent rules

With the default `rules: native`, the schemas use zod's own rules (`.min()`, `z.uuid()`), which differ from the contract in a few places.

- zod 4.5 and later count lengths in code points, like the contract. zod before 4.5 counts UTF-16 units: an emoji counts 2.
- `uuid` also checks the version and variant digits. `12345678-1234-0234-8234-123456789abc` is refused.
- `date-time` refuses a lowercase `t` or `z`, and accepts more than 9 fraction digits.
- `multipleOf` can be wrong on integers past about 2^53.

Set `rules: seampact-consistent` for the contract's exact checks. The title above then reads:

<!-- excerpt: packages/targets/codegen-zod/rules-snapshots/seampact-consistent/schemas/input.ts.snap -->
```ts
export const CreateTaskSchema = z.strictObject({
  title: z
    .string()
    .refine((value) => codePointLength(value) >= 1, {
      error: "Expected at least 1 character.",
      params: { rule: "minLength" },
    })
    .refine((value) => codePointLength(value) <= 200, {
      error: "Expected at most 200 characters.",
      params: { rule: "maxLength" },
    }),
  effort: z.int().gte(0).optional(),
});
```

The option is on the `validators` entry ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)).

## Limits

zod refuses by name a `oneOf`, a `default` on a property, a nullable value other than an opaque one, and the other forms listed in [Generate fails](../troubleshooting/generate.md#node-servers). No client guide uses these schemas.

## Next

- [Switch the validator](../configuration/validators.md) to yup or class-validator.
- The 400 body: [When a check fails](README.md#when-a-check-fails).
