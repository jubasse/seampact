### Options, artefacts and their defaults

| Setting | Values | Default | What it turns off |
|---|---|---|---|
| `query` | `tanstack`, `swr`, `rtk`, `fetch` | required | (no default library) |
| `errors` | `throw`, `data` | `throw` | errors in the library's error state |
| `invalidate` | `resource`, `off` | `resource` | refresh after a write |
| `staleTime` | `off`, `contract` | `off` | (opt-in freshness; refused with `swr` and `rtk`) |
| `infinite` | `on`, `off` | `on` | infinite queries |
| `useClientDirective` | `on`, `off` | `on` | the `"use client"` line |
| `keys.root` | string | the api name | (renames the first key segment; refused with `query: rtk`) |
| `artefacts.hooks` | boolean | `true` | the `use*` hooks; options factories and keys stay |
| `artefacts.itemsOf` | boolean | `false` | (opt-in `itemsOf` export) |

An unknown option key or value is refused by name (`options.unknown`, `options.<key>.invalid`), as `codegen-fetch` does; a missing `query` is `options.query.missing`. Three shapes have no switch. The idempotency key per mutation is the contract's wire guarantee. The other two are representation constraints set by the libraries, not features: `headers` as a plain record (a `Headers` object is not serialisable, so dehydration, persisters and the Redux store refuse it) and the RTK error as a plain value (RTK serialises a thrown error and loses its class, and its store warns on a non-plain value; the error state stays typed and `toContractError` restores the class).
