# Angular

seampact writes an Angular service per api over the typed `fetch` client. The client sends through your app's `HttpClient`, so your interceptors, XSRF settings and `withFetch()` apply. Reads are signals built on Angular's `resource()`. There is no query library. Tested with Angular 22.

## Add the targets

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: client
    use: "@seampact/codegen-fetch"
    apis: [notes]
    link: { types: types }
  - id: queries
    use: "@seampact/codegen-angular"
    apis: [notes]
    options: { query: fetch }
    link: { client: client }
```

`query: fetch` is the only value for now. Then run `npx seampact generate`.

## Provide the service

```ts
bootstrapApplication(App, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideNotesApi({ baseUrl: environment.apiUrl }),
  ],
});
```

`apiUrl` holds your backend URL: see [Point the client at your backend](backend-url.md). For Angular's XSRF header, keep the api on the page's origin and set `withXsrfConfiguration({ headerName })` to the CSRF header your contract declares.

## Use it in a component

```ts
export class NoteList {
  readonly folderId = input.required<string>();
  readonly notes = inject(NotesApi).listNotes(() => ({ query: { folderId: this.folderId() } }));
  readonly create = inject(NotesApi).createNote({ retry: 1 });

  async add() {
    const { error } = await this.create.mutate({ body: { title: "New note" } });

    if (!error) this.notes.refetch();
  }
}
```

- A read returns `{ data, error, isLoading, refetch }`, each a signal but `refetch`.
- The request is a function: when a signal it reads changes, the read starts again. Return `null` to skip a read.
- Create readers in a field initializer. Elsewhere, pass `{ injector }`.
- A read stops when the component (or the injector) is destroyed, or when its request changes.
- No read runs during server rendering. Pass `{ transferId: "notes" }` to read on the server and hand the data to the browser.
- There is no cache. A write does not refresh other readers: call `refetch`.
- `mutate` never throws. Each call resolves to its own `{ data }` or `{ error }`, a `ContractError` for a declared error. The `data`, `error` and `isPending` signals show the latest call.
- `retry` sends a failed write again with the same idempotency key, so the server runs it once. It takes a whole count (0 or more). A declared error is not retried.
- A write is not aborted when the component is destroyed.
- A paged list has no infinite reader. Change the request to read the next page.

`isContractError(error)` tells a declared error apart from a network failure. `inject(NotesApi).client` is the client itself, and `createNotesQueries(client)` gives the plain fetchers, for code outside Angular.

The service only reads and writes. Keep shared state in your own store or signals.

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `fetch` | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |

`staleTime`, `invalidate`, `infinite` and `keys.root` need a query library: `generate` refuses them. `state` (NgRx) is not generated yet and is refused too.

`errors: data` needs a client with `errorStyle: result`, which is the client's default.

`artefacts: { service: false }` keeps the plain fetchers only.

Errors: [Generate errors](../troubleshooting/generate.md).
