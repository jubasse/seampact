# yup

`@seampact/codegen-yup` writes a yup schema for each schema of your contract. NestJS, Express, Fastify, AdonisJS, Hono and Next.js can use them to refuse a bad request before your handler runs.

Used by: any Node server that takes the `validators` link: [NestJS](../backend/nestjs.md), [Express](../backend/express.md), [Hono](../backend/hono.md), [Next.js](../backend/nextjs.md), [Fastify](../backend/fastify.md) and [AdonisJS](../backend/adonisjs.md). The default is [zod](zod.md).

## Set up

Install `yup` in your app, then point the `validators` entry at this package.

```yaml
# seampact.config.yaml, under targets
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
```

Link it from your server entry, next to `types`:

```yaml
    link:
      types: types
      validators: validators
```

Run `npx seampact generate`. The files land in `validators/<api>/` under your `outDir`, with the same layout as [zod](zod.md) plus a `yup-support.ts`.

## What you get

For the `CreateTask` schema of the [overview](README.md), trimmed from `schemas/input.ts`:

<!-- excerpt: packages/targets/codegen-yup/rules-snapshots/native/schemas/input.ts.snap -->
```ts
export const CreateTaskSchema = yup
  .object({
    title: yup
      .string()
      .strict()
      .min(1, "Expected at least 1 character.")
      .max(200, "Expected at most 200 characters.")
      .defined(),
    effort: yup
      .number()
      .strict()
      .integer()
      .test({
        name: "minimum",
        message: "Expected at least -9007199254740991.",
        test: (value) =>
          value === undefined ||
          !Number.isInteger(value) ||
          value >= -Number.MAX_SAFE_INTEGER,
      })
      .test({
        name: "maximum",
        message: "Expected at most 9007199254740991.",
        test: (value) =>
          value === undefined ||
          !Number.isInteger(value) ||
          value <= Number.MAX_SAFE_INTEGER,
      })
      .min(0, "Expected at least 0.")
      .optional(),
  })
  .strict()
  .default(undefined)
  .test(unknownKeysTest);
```

The schema is strict: it refuses a value of the wrong type instead of converting it, and `unknownKeysTest` refuses a key the contract does not declare. The operation schemas in `operations/input.ts` check `path`, `query`, `headers` and `body` together.

## Use them in your code

```ts
import { inputSchemas } from "./__generated__/validators/notes/index.js";

const isValid = inputSchemas.CreateTaskSchema.isValidSync({ title: "" });
```

## When a check fails

Each yup error becomes one issue of the [400 body](README.md#when-a-check-fails). The generated checks carry the contract rule (`minimum`, `unknownKeys`) in their params, and the server reads that rule, never yup's own message.

## Native or consistent rules

With the default `rules: native`, the schemas use yup's own rules, which differ from the contract in a few places.

- Lengths count UTF-16 units: an emoji counts 2, so `maxLength: 1` refuses "😀".
- `uuid` also checks the version and variant digits, and refuses version 7 and the max UUID `ffffffff-ffff-ffff-ffff-ffffffffffff`.
- `date-time` checks only the digit layout: it accepts an empty string, month 13, hour 99, second 60, `2026-02-30`, an offset like `+01` or `+0100`, and more than 9 fraction digits. It refuses a lowercase `t` or `z`.
- A number with a wrong type also reports its range issues.
- `multipleOf` has no yup rule: it stays the contract's check.

Set `rules: seampact-consistent` for the contract's exact checks ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)).

## Limits

The generator refuses by name a `oneOf`, a property `default`, a `nullable` value other than an opaque one and the other forms in [Generate fails](../troubleshooting/generate.md#node-servers). No client guide uses these schemas.

## Next

- [Switch the validator](../configuration/validators.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
