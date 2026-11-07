# Switch the validator

A validator checks the data a request carries against the contract. Node servers pick the validator library. The other servers use their framework's own library and let you change only the `rules` mode, below. What each stack gets is in [Types and validation](../types-and-validation/README.md).

Use this page to change the validator library of the generated code on a Node server, or to make every target give the contract's exact checks.

The server target reads its validators from the entry its `validators` link names. In the `validators` entry of `seampact.config.yaml` (see [Generate the code](../getting-started/your-first-api.md#3-generate-the-code)), change the package.

```yaml
# seampact.config.yaml, under targets
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
```

`@seampact/codegen-zod` and `@seampact/codegen-yup` work on every Node server. `@seampact/codegen-class-validator` works on NestJS only. Install the library you pick in your app (`yup`, or `class-validator` and `class-transformer`), then run `seampact generate` ([commands per stack](../features/commands-per-stack.md)).

You see the `validators` folder rewritten. On NestJS, Express and Hono, a server without a `validators` link stops `generate` with `link.missing`, which names the packages to link.

Fastify and AdonisJS can skip it: leave out the `validators` entry and the link, and the server validates with the framework's own library, [Ajv](../types-and-validation/ajv.md) on Fastify and [VineJS](../types-and-validation/vinejs.md) on AdonisJS. Install `ajv` or `@vinejs/vine` in your app.

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

The error body names the same rule in both modes: `minLength`, `format`, `pattern`, and so on ([the 400 body](../types-and-validation/README.md#when-a-check-fails)). The option is in [Per-target options](reference.md#codegen-zod).

Where the native rules differ from the contract, the page of the library lists it: [zod](../types-and-validation/zod.md#native-or-consistent-rules), [yup](../types-and-validation/yup.md#native-or-consistent-rules), [class-validator](../types-and-validation/class-validator.md#native-or-consistent-rules) and [VineJS](../types-and-validation/vinejs.md#native-or-consistent-rules).

## Other servers

On AdonisJS, Laravel, Symfony and the Python servers, `rules` sits on the server entry. Each guide's options table says what it changes: [AdonisJS](../backend/adonisjs.md#options), [Laravel](../backend/laravel.md#options), [Symfony](../backend/symfony.md#options), [FastAPI](../backend/fastapi.md#options), [DRF](../backend/drf.md#options), [Ninja](../backend/ninja.md#options).

Spring Boot has no `rules` option: [Java records](../types-and-validation/java-records.md) says what it checks.

## Next

- Next: [OpenAPI and docs](openapi-and-docs.md).
- What each stack gets: [Types and validation](../types-and-validation/README.md).
- Every option: [Config reference](reference.md#per-target-options).
