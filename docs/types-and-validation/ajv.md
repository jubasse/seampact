# Ajv

The Fastify target writes its own Ajv validators from your contract when you link none. Ajv checks the request as JSON Schema, and the server names each issue by the contract rule.

Used by: [Fastify](../backend/fastify.md) only, when its entry has no `validators` link.

## Set up

Nothing to add: leave out the `validators` entry and the `validators` link, and install `ajv` in your app. The Fastify target writes the validators in its own `validators/` folder.

```sh
npm install fastify ajv @seampact/server-runtime @seampact/hooks
```

To use [zod](zod.md) or [yup](yup.md) instead, add a `validators` entry and link it ([Switch the validator](../configuration/validators.md)).

## What you get

The files have the same layout as the [zod](zod.md) ones. Each schema is a JSON Schema handed to Ajv through an adapter. For the `CreateTask` schema of the [overview](README.md), trimmed from `validators/schemas/input.ts`:

<!-- excerpt: packages/targets/codegen-fastify/own-validators-snapshots/validators/schemas/input.ts.snap -->
```ts
export const CreateTaskSchema = ajvStandardSchema({
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      seampactMessages: {
        minLength: "Expected at least 1 character.",
        maxLength: "Expected at most 200 characters.",
      },
    },
    effort: { type: "integer", minimum: 0, maximum: 9007199254740991 },
  },
  required: ["title"],
  additionalProperties: false,
});
```

`additionalProperties: false` refuses a key the contract does not declare. `seampactMessages` carries the text of each failure. One Ajv validator checks the whole request, and the reply lists every issue.

## When a check fails

Each Ajv error becomes one issue of the [400 body](README.md#when-a-check-fails). The adapter names it by the contract rule, such as `minLength` or `required`, never by Ajv's keyword.

## Native or consistent rules

The Fastify target has no `rules` option.

## Limits

The generator refuses by name a `oneOf`, a property `default` and the other forms in [Generate fails](../troubleshooting/generate.md#node-servers).

## Next

- [Fastify](../backend/fastify.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
