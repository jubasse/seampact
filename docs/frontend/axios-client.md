# Axios client

The axios client is the [fetch client](fetch-client.md) sent through your own axios instance. Its interceptors, base settings and adapter apply. The React, Vue and Angular targets run over it unchanged.

## Add the target

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: client
    use: "@seampact/codegen-axios"
    apis: [notes]
    link: { types: types }
```

Install `axios` (1.7 or later, below 2) and `@seampact/codegen-fetch` in your project, then run `npx seampact generate`. The options are the fetch client's: `errorStyle: result` or `throw`.

## Create and call it

```ts
import axios from "axios";
import { createClient, fetchOfAxios } from "./__generated__/client/notes/index.js";

const instance = axios.create({ headers: { authorization: "Bearer my-token" } });

const client = createClient({
  baseUrl: "http://localhost:3000",
  fetch: fetchOfAxios(instance),
});

const reply = await client.getNote({ path: { noteId: "n1" } });
```

The settings, the results and `ContractError` are the fetch client's.

## What axios does here

- Every HTTP status comes back as a result. The client sorts statuses itself, so axios never rejects on one.
- A network failure rejects. An abort rejects with the signal's reason, and `timeoutMs` with a `TimeoutError`.
- Responses are read as text and parsed by the client: your `transformResponse` does not apply.
- A response interceptor that throws on an error status rejects the call. That is your choice, and the client does not map it.
- A response interceptor must return the axios response: one that returns `response.data` makes the call throw a `TypeError`.
- Set `baseUrl` in `createClient`, not in the instance: the client sends full URLs.
