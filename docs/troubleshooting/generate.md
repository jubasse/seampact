# Target option errors and generate warnings

| You see | Do |
|---|---|
| `options.unknown`, `options.invalid`, `options.<key>.invalid` | Use only the options the target's page lists, with one of its values. |
| `options.query.missing` | The React, Vue and Angular targets need `query`, for example `query: fetch`. |
| `names.collision` | Two operations would get the same generated name, such as an action, a store member or a service member. Rename one operation in the contract, or drop `state`. |
| `artefact.service.needed` | `state: ngrx` and `state: ngrx-signals` call the generated service. Add `service` to the target's `artefacts`, or drop `state`. |
| `options.query.unsupported` | This release generates `tanstack` only. |
| `options.staleTime.unsupported`, `options.keys.root.unsupported` | That option has no place with this query library. Drop it. |
| `options.keys.invalid`, `options.keys.root.invalid` | Write `keys: { root: <name> }`. |
| `options.errors.unsupported` | `errors: data` needs a client with `errorStyle: result`. |
| `options.springSecurity.unavailable` (Spring Boot) | `springSecurity` is on, but Spring Security is not on the classpath. Add `spring-boot-starter-security`, or set `springSecurity: false`. |
| `options.springSecurity.matchers.unavailable` (Spring Boot) | `springSecurity: { matchers: true }` needs `spring-security-config`. Add `spring-boot-starter-security`, or set `springSecurity: true`. |
| `options.reply.invalid` (NestJS) | `reply` is `handler` or `interceptor`. |

A warning does not stop `generate`.

| You see | Do |
|---|---|
| `paging.infinite.skipped` | The list gets no infinite query, because its paging style does not tell the next page. Use the plain query with the position parameter, or add a next-page fact to the paging style. Silence it with `warnings.ignore: [paging.infinite]`. |

For `link.client.errorStyle.unsupported`, see [Link errors](link.md).
