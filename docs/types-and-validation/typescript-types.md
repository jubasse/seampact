# TypeScript types

`@seampact/codegen-ts` writes one TypeScript type for each schema of your contract, and one input, output and error type for each operation. Every Node server and every client uses them.

Used by: [NestJS](../backend/nestjs.md), [Express](../backend/express.md), [Fastify](../backend/fastify.md), [AdonisJS](../backend/adonisjs.md), [Hono](../backend/hono.md), [Next.js](../backend/nextjs.md) and the [fetch client](../frontend/fetch-client.md) with the clients built on it.

## Set up

```yaml
# seampact.config.yaml, under targets
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
```

The target has no options. Run `npx seampact generate`; the files land in `types/<api>/` under your `outDir`.

## What you get

For the `CreateTask` schema of the [overview](README.md), in `schemas.ts`. A property outside `required` gets a `?`:

<!-- excerpt: packages/targets/codegen-ts/types-snapshots/schemas.ts.snap -->
```ts
export interface CreateTask {
  title: string;
  effort?: number;
}
```

An enum is a union of its values:

<!-- excerpt: packages/targets/codegen-ts/types-snapshots/schemas.ts.snap -->
```ts
export type TaskState = "open" | "done" | "archived";
```

Each operation has an input type over the parts it declares among `path`, `headers`, `query` and `body`, in `operations/input.ts`:

<!-- excerpt: packages/targets/codegen-ts/types-snapshots/operations/input.ts.snap -->
```ts
export type CreateTaskInput = {
  path: {
    channelId: string;
  };
  headers: {
    authorization?: string;
    "x-csrf-token"?: string;
    "idempotency-key": string;
  };
  body: schemas.CreateTask;
};
```

An output type lists the success statuses the handler may return, and an errors type lists the error codes with their params. `constants.ts` has the `Status` and `ErrorCode` objects, so you write `Notes.Status.NotFound` and never a bare number.

`uuid` and `date-time` values stay `string`. An opaque value is `unknown`, a list is `T[]`, a map is `Record<string, T>`.

## Use them in your code

```ts
import * as Notes from "./__generated__/types/notes/index.js";

const note: Notes.schemas.Note = { noteId, title: "Buy milk", createdAt };
```

The types check your code while you write it. They do not check a request at run time: that is the job of the [validator](README.md#what-your-stack-gets) your server uses.

## Limits

The generator refuses by name a `oneOf`, a `nullable` value other than an opaque one, a property `default` and the other forms in [Generate fails](../troubleshooting/generate.md#node-servers).

## Next

- Run-time checks: [Types and validation](README.md#what-your-stack-gets).
- Use the types in a client: [Fetch client](../frontend/fetch-client.md).
