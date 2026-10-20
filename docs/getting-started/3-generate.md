# 3. Generate the code

The config tells seampact where the contract is and what to generate. Create `seampact.config.yaml` in the app folder.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: validators
    use: "@seampact/codegen-zod"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-nestjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__` and `openapi/notes.yaml`. Commit them: `seampact check` fails later if they drift from the contract.

Every config key is in [configuration](configuration.md).

Using Express? Put `@seampact/codegen-express` in `use` of the `server` target instead of `@seampact/codegen-nestjs`.

Next: [4. Write the handlers](4-handlers-nestjs.md), or [for Express](4-handlers-express.md)
