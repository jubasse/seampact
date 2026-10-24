# Target option errors and generate warnings

| You see | Do |
|---|---|
| `options.unknown`, `options.invalid`, `options.<key>.invalid` | Use only the options the target's page lists, with one of its values. |
| `options.query.missing` | The React target needs `query: tanstack`. |
| `options.query.unsupported` | This release generates `tanstack` only. |
| `options.staleTime.unsupported`, `options.keys.root.unsupported` | That option has no place with this query library. Drop it. |
| `options.keys.invalid`, `options.keys.root.invalid` | Write `keys: { root: <name> }`. |
| `options.errors.unsupported` | `errors: data` needs a client with `errorStyle: result`. |
| `options.reply.invalid` (NestJS) | `reply` is `handler` or `interceptor`. |

A warning does not stop `generate`.

| You see | Do |
|---|---|
| `paging.infinite.skipped` | The list gets no infinite query, because its paging style does not tell the next page. Use the plain query with the position parameter, or add a next-page fact to the paging style. Silence it with `warnings.ignore: [paging.infinite]`. |

For `link.client.errorStyle.unsupported`, see [Link errors](link.md).
