# MSW mocks

seampact writes [Mock Service Worker](https://mswjs.io) 2 handlers for each operation of your contract. Your tests and your dev server run the typed `fetch` client against them, with no backend.

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
  - id: mocks
    use: "@seampact/codegen-msw"
    apis: [notes]
    link: { types: types }
```

Install `msw` 2, then run `npx seampact generate`.

## Start the handlers

```ts
import { setupServer } from "msw/node";
import { createMocks } from "./__generated__/mocks/notes/index.js";

const mocks = createMocks({ baseUrl: "http://localhost" });
const server = setupServer(...mocks.handlers);
```

Give `createMocks` the same `baseUrl` as your client. Two apis on one origin whose paths overlap: list the handlers of the api with the more specific paths first. In the browser, use `setupWorker` from `msw/browser` and copy the worker script once with `npx msw init public`.

## Answer in a test

A handler answers the route's example from the contract. A route with no example has nothing to answer: the call gets a 500 that names the route, until your test gives a reply.

```ts
server.use(mocks.getNote.reply(200, { id: "n1", title: "Hello" }));
server.use(mocks.createNote.error("api.rate_limited", { retryAfterMs: 1500 }));
server.use(
  mocks.getNote.resolve(({ params }) =>
    params.id === "n1" ? { status: 200, body: { id: "n1", title: "Hi" } } : { status: 404, code: "api.not_found" },
  ),
);
```

The status, body, error code and params are typed from the contract. A reply is written like your server writes it: the same envelope, the same page links, and errors in your error format. Call `server.resetHandlers()` after each test.

## Not yet

- The handlers do not check the request. The option `validateRequests` is refused until they do.
- The default handler answers success examples only, never an error or a request example.
- A form the fetch client cannot read yet is refused the same way here.
- Pages whose numbers or totals the server computes, such as the Laravel and Spring packs' pages, are refused by name.
