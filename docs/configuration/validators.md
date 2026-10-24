# Switch the validator

Change the validator library of the generated code.

The server target reads its validators from the entry its `validators` link names. Change the package of that entry.

```yaml
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
```

`@seampact/codegen-zod`, `@seampact/codegen-yup` and `@seampact/codegen-class-validator` work with the NestJS server. Install the library you pick in your app (`yup`, or `class-validator` and `class-transformer`), then run `npx seampact generate`.

You see the `validators` folder rewritten. On NestJS, Express and Hono, a server without a `validators` link stops `generate` with `link.missing`, which names the packages to link.

Fastify and AdonisJS can skip it: leave out the `validators` entry and the link, and the server validates with the framework's own library, Ajv on Fastify and VineJS on AdonisJS. Install `ajv` or `@vinejs/vine` in your app.

## Native or consistent rules

By default the generated validators use the library's own rules, such as `.min()`, `.uuid()` or `@IsUUID()`. Your library behaves as you know it.

Set `rules: seampact-consistent` to get the contract's exact checks instead. Every client, server and language then gives the same answer.

```yaml
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
    options:
      rules: seampact-consistent
```

The error body names the same rule in both modes: `minLength`, `format`, `pattern`, and so on.

With the default `rules: native`, each library differs from the contract in a few places.

### zod

- zod 4.5 and later count lengths in code points, like the contract. zod before 4.5 counts UTF-16 units: an emoji counts 2.
- `uuid` also checks the version and variant digits. `12345678-1234-0234-8234-123456789abc` is refused.
- `date-time` refuses a lowercase `t` or `z`, and accepts more than 9 fraction digits.
- `multipleOf` can be wrong on integers past about 2^53.

### yup

- Lengths count UTF-16 units: an emoji counts 2, so `maxLength: 1` refuses "😀".
- `uuid` also checks the version and variant digits.
- `date-time` does not check the calendar: `2026-02-30T00:00:00Z` passes. It also accepts second 60, hour 24 and an offset without a colon, and refuses a lowercase `t` or `z`.
- A number with a wrong type also reports its range issues.
- `multipleOf` has no yup rule: it stays the contract's check.

### class-validator

- Lengths skip the variation selectors U+FE0E and U+FE0F: "❤️" counts 1.
- `uuid` also checks the version and variant digits.
- `date-time` does not check the calendar, and accepts second 60 and a space instead of `T`.
- `exclusiveMinimum` and `exclusiveMaximum` have no class-validator rule: they stay the contract's checks. So do the checks on each item of a list, which report the item's position.
