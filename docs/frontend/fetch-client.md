# Fetch client

The fetch client is a typed function per operation of your contract, sent with the platform `fetch`. The React, Vue, Angular, MSW and mobile pages all build on it. The types come from [TypeScript types](../types-and-validation/typescript-types.md).

## Add the target

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: client
    use: "@seampact/codegen-fetch"
    apis: [notes]
    link: { types: types }
```

Run `npx seampact generate`. The client has no runtime dependency.

## Create and call it

```ts
import { createClient } from "./__generated__/client/notes/index.js";

const client = createClient({ baseUrl: "http://localhost:3000" });

const reply = await client.getNote({ path: { noteId: "n1" } });

if (reply.ok) {
  console.log(reply.body.title);
} else if (reply.unexpected) {
  console.log("The server answered something the contract does not declare", reply.status);
} else {
  console.log(reply.code, reply.params);
}
```

One method per operation, named like the operation. The request has `path`, `query`, `headers` and `body` members, only the ones the operation uses. Where the `baseUrl` comes from: [Point the client at your backend](backend-url.md).

## Client settings

| Setting | What it does |
|---|---|
| `baseUrl` | The server root. Required. A trailing `/` is ignored. |
| `fetch` | Your own `fetch`, for credentials, tests or a platform without a global one. |
| `headers` | Headers sent on every call. It must not carry a header the client fills itself (the idempotency or deadline header). |
| `idempotencyKey` | A function that returns a new key. Needed where `crypto.randomUUID` is missing, such as [Expo](mobile.md). |

Each call takes an optional last argument with `signal` (an `AbortSignal`) and `timeoutMs`. An operation with a time budget in the contract uses it unless you pass `timeoutMs`. An operation with a deadline header and no budget needs `timeoutMs`.

`createClient` throws at start when the platform has no `fetch` and you passed none. It also throws when an operation generates an idempotency key and the platform lacks `crypto.randomUUID`, unless you pass `idempotencyKey`. A network failure, a timeout or an abort rejects the promise.

## What a call returns

| Answer | Shape |
|---|---|
| Success | `{ ok: true, status, body, headers }` |
| Not modified | `{ ok: true, status: 304, headers }` (an operation with an ETag) |
| Declared error | `{ ok: false, unexpected: false, status, code, params, headers }` |
| Anything else | `{ ok: false, unexpected: true, status, body, headers }` |

`code` is an error code from the operation's contract. `params` is there when the code declares some. `body` of an unexpected answer is the parsed JSON, or the text. The client does not check response bodies.

## ContractError

With `errorStyle: throw`, a call returns the success and throws everything else as a `ContractError`.

```yaml
  - id: client
    use: "@seampact/codegen-fetch"
    apis: [notes]
    link: { types: types }
    options: { errorStyle: throw }
```

```ts
import { createClient, isClientContractError } from "./__generated__/client/notes/index.js";

try {
  const note = await client.getNote({ path: { noteId: "n1" } });
} catch (error) {
  if (isClientContractError(error) && error.operation === "getNote") {
    console.log(error.failure.status, error.failure);
  }
}
```

| Field | What it holds |
|---|---|
| `operation` | The operation name, such as `"getNote"`. Narrow on it to read that operation's declared errors. |
| `failure` | The error result from the table above: `status`, and `code` and `params` for a declared error. |
| `message` | For example `The operation 'getNote' answered 404 'api.not_found'.` |

`isClientContractError(error)` tells a `ContractError` from a network failure. The hooks, composables and services use `isContractError` for the same job.

| `errorStyle` | Default | Use it with |
|---|---|---|
| `result` | yes | Everything. The React, Vue and Angular targets need it. |
| `throw` | no | Plain code that prefers `try` and `catch`. |

A value other than these two fails with `options.errorStyle.invalid`; any other key fails with `options.unknown` ([Generate errors](../troubleshooting/generate.md#clients)).

## Idempotency keys

An operation that declares idempotency gets its key header filled on each call, from `crypto.randomUUID` or your `idempotencyKey` function. To retry a write safely, pass the key yourself in the request's `headers`: the server then runs it once. A success of such a write has `replayed: true` when the server answered from its store.

## Shared behaviours with `query: fetch`

React, Vue and Angular can run with no query library (`query: fetch`). These behaviours are the same on the three:

- Pass `null` as the request to skip a read.
- A read stops when the component goes away or its request changes.
- There is no cache. A write does not refresh other reads: call `refetch`.
- `mutate` never throws. Each call resolves to its own `{ data }` or `{ error }`, a `ContractError` for a declared error. The latest call shows in `data`, `error` and `isPending`.
- `retry` sends a failed write again with the same idempotency key. It takes a whole count (0 or more). A declared error is not retried.
- A write is not aborted when the component goes away.
- A paged list has no infinite hook: change the request to read the next page.
- `staleTime`, `invalidate`, `infinite`, `keys.root` and the `itemsOf` artefact need a query library: `generate` refuses them.
- The hooks need a client with `errorStyle: result`: `generate` refuses `throw`.

Each page lists what differs on its framework.

## Limits

Forms the client does not read yet are refused by name when you generate: see [Generate errors](../troubleshooting/generate.md#clients).

## Next

[React](react.md), [Vue](vue.md), [Angular](angular.md), [Expo and React Native](mobile.md) or [MSW mocks](msw.md).
