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

The generated schemas use a few helpers where the library's own rule means something else. For example, zod's and yup's `.min()` and `.max()` count UTF-16 units, so `"😀"` has length 2; the contract counts characters, so the generated code checks the length with a helper. This keeps the client, the server and the OpenAPI document in agreement.
