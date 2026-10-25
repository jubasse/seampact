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

`apiUrl` holds your backend URL: see [Point the client at your backend](backend-url.md). For Angular's XSRF header, keep the api on the page's origin and set `withXsrfConfiguration({ headerName })` to the CSRF header your contract declares. For cookies on a cross-origin api, set `withCredentials` in an interceptor: the config has no `fetch` option.

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
- No read runs during server rendering. Pass `{ transferId: "notes" }` to read on the server and hand the data to the browser. Angular's server transfer caps a body at 1 MiB, so a larger read fails there.
- There is no cache. A write does not refresh other readers: call `refetch`.
- `mutate` never throws. Each call resolves to its own `{ data }` or `{ error }`, a `ContractError` for a declared error. The `data`, `error` and `isPending` signals show the latest call.
- `retry` sends a failed write again with the same idempotency key, so the server runs it once. It takes a whole count (0 or more). A declared error is not retried.
- A write is not aborted when the component is destroyed.
- A paged list has no infinite reader. Change the request to read the next page.

`isContractError(error)` tells a declared error apart from a network failure. `inject(NotesApi).client` is the client itself, and `createNotesQueries(client)` gives the plain fetchers, for code outside Angular.

The service only reads and writes. Keep shared state in your own store or signals.

## NgRx

Add `state: ngrx` to the options, and install `@ngrx/store` and `@ngrx/effects` 22:

```yaml
    options: { query: fetch, state: ngrx }
```

seampact then writes typed actions and effects. Your reducers, selectors and state stay yours.

```ts
bootstrapApplication(App, {
  providers: [
    provideHttpClient(),
    provideStore({ notes: notesReducer }),
    provideNotesApi({ baseUrl: environment.apiUrl }),
    provideNotesEffects(),
  ],
});

store.dispatch(NotesActions.listNotes({ request: { query: { folderId } } }));

export const notesReducer = createReducer(
  initialNotes,
  on(NotesActions.listNotesSuccess, (state, { data }) => ({ ...state, items: data.body.items })),
  on(NotesActions.listNotesFailure, (state, { error }) => ({ ...state, error: error.message })),
);
```

- One action group per resource of the contract: `NotesActions` for `notes`. Operations with no resource are in `<Api>ApiActions`.
- Each operation has three actions: `listNotes` with the `request`, `listNotesSuccess` with the `request` and `data`, `listNotesFailure` with the `request` and the typed `error`.
- An effect sends each action through the service. Every error ends in the failure action, a `ContractError` for a declared error. The effect keeps running.
- A new read of an operation aborts the previous one still running.
- Writes run side by side. Each write action sends its own idempotency key. There is no retry: dispatch again to retry.
- An operation that needs a timeout takes `call: { timeoutMs }` in its action.
- `state: ngrx` needs the `service` artefact.

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `fetch` | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `state` | `ngrx` (actions and effects) | none |

`staleTime`, `invalidate`, `infinite` and `keys.root` need a query library: `generate` refuses them. `state: ngrx-signals` (Signal Store) is not generated yet and is refused too.

`errors: data` needs a client with `errorStyle: result`, which is the client's default.

`artefacts: { service: false }` keeps the plain fetchers only.

Errors: [Generate errors](../troubleshooting/generate.md).
