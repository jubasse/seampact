<!-- Generated from docs/troubleshooting/generate.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Generate errors

Page: https://jubasse.github.io/seampact/troubleshooting/generate/

`seampact generate` refuses a target option it does not know, or a form of your contract that a target does not generate yet. Each refusal has a code. Find yours in the table of your family, then follow the fix. A warning does not stop `generate`.

| Family | Section |
|---|---|
| Fetch, React, Vue, Angular, MSW | [Clients](https://jubasse.github.io/seampact/troubleshooting/generate/#clients) |
| Express, Fastify, Hono, NestJS, AdonisJS | [Node servers](https://jubasse.github.io/seampact/troubleshooting/generate/#node-servers) |
| Spring Boot | [Spring Boot](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot) |
| Laravel, Symfony | [PHP](https://jubasse.github.io/seampact/troubleshooting/generate/#php) |
| FastAPI, Django REST framework, Django Ninja | [Python](https://jubasse.github.io/seampact/troubleshooting/generate/#python) |
| Spring Boot, PHP and Python share the code | [Spring Boot, PHP and Python](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python) |
| Several servers share the code | [Every server](https://jubasse.github.io/seampact/troubleshooting/generate/#every-server) |
| Warnings | [Warnings](https://jubasse.github.io/seampact/troubleshooting/generate/#warnings) |

"Remove the operation from `operations`" means: list only the other operations in the target entry's `operations` filter, then run `generate` again.

## Clients

| Code | Cause and fix |
|---|---|
| `options.unknown`, `options.invalid`, `options.<key>.invalid` | The target gets an option it does not have, or a value it does not take. Use only the options on the target's page, with one of its values. |
| `options.errorStyle.invalid` | The fetch client's `errorStyle` is neither `result` nor `throw`. Set it to one of them. |
| `options.query.missing` | The React, Vue and Angular targets need `query`. Write `query: tanstack`, `swr`, `rtk`, `pinia-colada` or `fetch`, as the framework page lists. |
| `options.staleTime.unsupported`, `options.keys.root.unsupported` | That option has no place with this query library. Drop it. |
| `options.keys.invalid`, `options.keys.root.invalid` | `keys` is not written as asked. Write `keys: { root: <name> }`. |
| `options.errors.unsupported` | `errors: data` needs a client with `errorStyle: result`, and the linked client throws. Link a client with `errorStyle: result`, or drop `errors: data`. |
| `link.client.errorStyle.unsupported` | React, Vue and Angular need a fetch client with `errorStyle: result`. Set it on the client target, or drop the link. See [Link errors](https://jubasse.github.io/seampact/troubleshooting/link/). |
| `options.validateRequests.unsupported` | MSW handlers do not check the request yet. Drop `validateRequests`. |
| `artefact.service.needed` | `state: ngrx` and `state: ngrx-signals` call the generated service. Add `service` to the target's `artefacts`, or drop `state`. |
| `names.collision` | Two operations would get the same generated name (an action, a store member or a service member). Rename one operation in the contract, or drop `state`. |
| `wire.urls.absolute.unsupported` | The pages and links of a list are written as absolute URLs, which the client, the mocks and the Node servers do not read yet. Set `conventions.urls` to `relative`. |

## Node servers

Express, Fastify, Hono, NestJS and AdonisJS.

| Code | Cause and fix |
|---|---|
| `type.nullable.unsupported` | A property or type is `nullable: true`, and the Node servers cannot generate that (only an opaque value, which is `unknown`, may be nullable). Remove `nullable`, or make the property optional instead. |
| `options.reply.invalid` | NestJS `reply` takes `handler` or `interceptor`. Use one of them. |
| `runtime.output-directory-missing` | A programmatic generate request gave no `outputDirectory`. Pass the api's output directory; `seampact generate` always does. |
| `idempotency.enforce.unsupported` | The operation sets `idempotency.enforce: none`, which the Node servers do not generate. Keep `boundary`. |
| `paging.sortKey.restricted.unsupported` | A sort key guarded by a field right is not served. Leave the key out of `sortable` (a key of a restricted field inherits its right), or remove the operation from `operations`. |
| `fieldRight.nestedPointer.unsupported` | An input field right sits below the top level of the body. Move the right to a top-level field, or remove the operation from `operations`. |
| `access.optional.unsupported` | The operation allows a request with or without a credential (optional auth). Make the access required or public, or remove the operation from `operations`. |
| `paging.sort.style.unsupported` | The paging `sort` parameter uses the `split` style. Use another sort style, or remove the operation from `operations`. |

## Spring Boot

The forms refused by Spring Boot, PHP and Python are [in their own table](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python).

| Code | Cause and fix |
|---|---|
| `options.layout.unsupported` | One file per public type is the only layout. Remove `layout`. |
| `schema.union.unsupported`, `schema.map.unsupported`, `type.file.unsupported` | Spring Boot and PHP: a `oneOf`, a map schema and a file value are not generated yet. Remove the operation from `operations`. |
| `options.springSecurity.unavailable` | `springSecurity` is on, but Spring Security is not on the classpath. Add `spring-boot-starter-security`, or set `springSecurity: false`. |
| `options.springSecurity.matchers.unavailable` | `springSecurity: { matchers: true }` needs `spring-security-config`. Add `spring-boot-starter-security`, or set `springSecurity: true`. |

## PHP

Laravel and Symfony. The forms refused by Spring Boot, PHP and Python are [in their own table](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python).

| Code | Cause and fix |
|---|---|
| `options.layout.unsupported` | One file per class under the PSR-4 directory is the only layout. Remove `layout`. |
| `schema.union.unsupported`, `schema.map.unsupported`, `type.file.unsupported` | Spring Boot and PHP: a `oneOf`, a map schema and a file value are not generated yet. Remove the operation from `operations`. |
| `input.multipart.unsupported`, `input.form.unsupported`, `type.file.unsupported` | Form, multipart and file values are not generated yet. Remove the operation from `operations`, or open an issue with your use case. |

## Python

FastAPI, Django REST framework and Django Ninja. The forms refused by Spring Boot, PHP and Python are [in their own table](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python).

| Code | Cause and fix |
|---|---|
| `options.indent.unsupported` | The Python targets take `rules`, `responses`, `bodyValidation`, `frameworkEtag` and `catchAll` (Ninja also `views`), and `indent` is 4. Remove the option. |
| `artefacts.unknown` | The entry switches an artefact the target does not have. FastAPI and Ninja take `routeHelpers`, `bootCheck`, `accessHooks` and `nativeDocs`; DRF takes the same but `nativeDocs`. |
| `artefacts.bootCheck.hooks.invalid`, `artefacts.bootCheck.frameworkRoutes.invalid`, `artefacts.bootCheck.invalid`, `artefacts.<key>.invalid` | The value is not one the key takes. `hooks` takes `error` or `off`, `frameworkRoutes` takes `true`, `false` or `strict`, `bootCheck` a boolean or a map, other artefacts a boolean. |
| `nativeDocs.document.ambiguous` | The api declares several documents and the framework's document can follow only one. Set `document` on the entry, or drop `nativeDocs`. |
| `artefacts.nativeDocs.operation-missing` | The document the entry names lacks an operation the entry generates. Set `document` to one that holds them all, or drop `nativeDocs`. |
| `artefacts.nativeDocs.component-clash` | FastAPI: a contract schema is named `ValidationError` or `HTTPValidationError`, which FastAPI's own document holds. Rename the schema, or switch `nativeDocs` off for this api. |
| `artefacts.nativeDocs.document-missing` | `seampact-ir` is older than the target. Install the same release of both. |
| `access.<kind>.unsupported`, `identity.principal.unsupported` | The access form is not generated yet, such as a signed identity on FastAPI, or a principal that is not one schema. Remove the operation from `operations`. |
| `rule.<key>.unsupported` | DRF: a rule has no DRF check under `rules: native`. Use `rules: seampact-consistent`, which checks it, or remove the rule from that use. |
| `format.<format>.unsupported`, `type.<kind>.unsupported`, `deadline.header.type.unsupported` | A string format, a type or a deadline header type is not generated yet. Remove the operation from `operations`. |
| `response.binary.unsupported`, `response.redirect.unsupported` | Downloads and redirects are not generated yet. Remove the operation from `operations`. |
| `input.media.unsupported`, `body.kind.unsupported` | Form, multipart and file bodies, and a body that is not an object schema, are not generated yet. Remove the operation from `operations`. |
| `schema.union.unsupported`, `schema.map.unsupported` | A `oneOf` or a map schema is not generated yet. Remove the operation from `operations`. |
| `enum.open.unsupported`, `enum.narrowed.unsupported`, `unknownKeys.keep.unsupported`, `extensionKeys.unsupported`, `paging.handlerResult.unsupported` | An open or narrowed enum, kept unknown keys, typed extension values and some paging facts are not generated yet. Remove the operation from `operations`. |
| `param.path.structured.unsupported`, `param.header.structured.unsupported`, `param.default.unsupported`, `member.default.unsupported` | A path or header parameter that is not a scalar or an enum, and a default value, are not generated yet. Remove the operation from `operations`. |
| `path.param.type.unsupported` | A path parameter is not a string, a number or an enum. Remove the operation from `operations`. |
| `path.segment.literal.unsupported`, `path.segment.mixed.unsupported` | A fixed path segment holds `{`, `}` or `?`, or a segment mixes a parameter with text. Write each segment as a whole parameter or whole text. |
| `path.param.missing`, `name.segment.missing` | The IR is not one seampact wrote. Compile the contract again with the same seampact release, or update the target. |
| `name.collision` | Two schemas, members or errors give the same Python name. Rename one in the contract, or give one a `codeName`. |
| `principalRequires.unsupported`, `bindings.unsupported`, `upstream.unsupported`, `features.unsupported` | The operation uses an access or relay form the Python targets do not generate yet. Remove the operation from `operations`. |

## Spring Boot, PHP and Python

Spring Boot, Laravel, Symfony, FastAPI, Django REST framework and Django Ninja refuse these forms. The Spring Boot, PHP and Python pages link here.

| Code | Cause and fix |
|---|---|
| `scope.source.unsupported` | A scope id is read from somewhere other than the path. Read it from the path, or remove the operation from `operations`. |
| `principal.variants.unsupported` | The principal has several variants. Use one principal schema, or remove the operation from `operations`. |
| `signature.application.unsupported`, `signature.key.source.unsupported` | A signature your application verifies, or a key read from the request, is not generated yet. Use a signature template with a key value, or remove the operation from `operations`. |
| `fieldRight.nestedPointer.unsupported` | An input field right sits below the top level of the body. Move the right to a top-level field, or remove the operation from `operations`. |
| `bucket.key.unsupported`, `rule.proof.placement.unsupported` | A rate-limit bucket key or a rule proof is read from a place the server does not read yet. Remove the operation from `operations`. |
| `scalar.content.unsupported`, `response.media.unsupported`, `response.header.unsupported` | A JSON string content, a non-JSON response and a response header written by the route are not generated yet. Remove the operation from `operations`. |
| `unknownKeys.keep.unsupported`, `extensionKeys.unsupported` | Kept unknown keys and typed extension values are not generated yet. Remove the operation from `operations`. |
| `options.handlers.unsupported`, `options.naming.unsupported` | `handlers` is `perResource` only, and the naming options (`suffixes`, `perOperation` and the like) are not options of these targets. Remove the option. |

## Every server

Codes several servers share. The cause names the servers it applies to.

| Code | Cause and fix |
|---|---|
| `format.success.envelope.unsupported`, `format.success.slot.unsupported`, `format.success.headers.unsupported`, `format.meta.unsupported` | Node servers, Spring, Laravel and Symfony: the format pack writes an envelope, slot, success header or meta member the server cannot write. Use a format whose envelope puts `$payload` under named members, with no meta member and no success header, or another server. |
| `paging.response.slot.unsupported` | The page writes a slot the server does not fill: `$resource`, `$collection`, an item's id or URL, or `$page` under an offset style. Use a paging style whose page writes only its response roles, or another server. |
| `paging.sortKey.right.unsupported` | Spring Boot, PHP and Python: a sort key guarded by a field right is not served. Leave the key out of `sortable`, or remove the operation from `operations`. |
| `scheme.query.unsupported`, `scheme.basic.unsupported` | The servers read a credential from a bearer token, a cookie or a header only. Use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`. |
| `degradable.unsupported` | Node servers, Spring, Laravel and Symfony do not generate `degradable` operations yet. Remove the operation from `operations`. |
| `concurrency.etag.withoutWrite.unsupported` | A read writes an `ETag` for a resource whose `If-Match` writes sit in another api, so the server has no field to read the version from. Serve the read and its writes in one api, or remove the read from `operations`. |
| `deprecated.successor.otherApi.unsupported` | A deprecated operation names a successor in another api, whose URL the server cannot write in its `Link` header yet. Name a successor in the same api, or drop the successor. |
| `identity.response.header.unsupported` | The identity declares a response header (a `versionToken`, or one declared `in: response`) that no server writes yet. Remove the header from the identity's `headers`, or declare a deadline, trace or actor header `in: request`. |
| `right.extensions.unsupported`, `rule.extensions.unsupported`, `scope.extensions.unsupported` | Node servers, Spring, Laravel and Symfony: the decide and resolve requests do not carry custom metadata yet. Remove the `extensions` of that right, rule or scope, or the operations that use it from `operations`. |
| `property.default.unsupported` | Spring, Laravel and Symfony do not fill a body member's default, so the handler would receive it absent. Remove the `default`, or the operations that use the schema from `operations`. |
| `param.query.structured.unsupported` | PHP and Python: a query parameter that is not a scalar, an enum or a list of them in the `form` style (an object, a list of lists, `deepObject`) is not read yet. Make the param a scalar, an enum or a list of them, or remove the operation from `operations`. |
| `query.list.brackets.unsupported` | The fetch client and every server: a list sent as `tag[]=a&tag[]=b` is not read yet. Set `conventions.query.lists` to `repeat` or `comma`. |
| `response.shape.unsupported` | The fetch client, Node servers, Spring, Laravel and Symfony do not generate download or redirect responses yet. Remove the operation from `operations`. |
| `path.segment.encoded.unsupported` | A fixed path part has a space, a control or non-ASCII character, or one of `"` `<` `>` `^` `\` `{` `}` `|` `[` `]` or a backtick, which a client would send percent-encoded. Use plain ASCII letters, digits and `-` in that part. |
| `artefacts.accessHooks.unsupported` | Laravel, Symfony, FastAPI, DRF and Ninja: `accessHooks: false` (native access) is not generated yet. Keep the hooks, and read the framework's own auth in the authenticate hook. |
| `artefacts.bootCheck.hooks.warn.unsupported`, `artefact.bootCheck.hooks.warn.unsupported` | PHP, Python and Spring Boot (`artefact.` there): starting with a hook missing (`warn`) is not generated yet. Use `error` (the default) or `off`. |
| `runtime.missing` | Node servers and Spring: the app does not install the runtime. Install `@seampact/server-runtime` (Node) or add `seampact-spring-runtime` (Maven; the Gradle plugin adds it) at the generator's version. |
| `runtime.version-mismatch` | Node servers and Spring: the installed runtime has another `major.minor`, or an older patch, than the generator. Install it at the generator's version; a later patch passes. With Gradle, remove the BOM or forced version that overrides the plugin's. |
| `runtime.generated-for-other-version` | See [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/). |

## Warnings

| Code | Cause and fix |
|---|---|
| `identity.headers.handler` | The identity declares request headers (deadline, trace) and the boundary only checks they are well formed. Your handler reads them. Silence it with `warnings.ignore: [identity.headers.handler]` once it does. |
| `paging.infinite.skipped` | The list gets no infinite query, because its paging style does not tell the next page. Use the plain query with the position parameter, or add a next-page fact to the paging style. Silence it with `warnings.ignore: [paging.infinite]`. |

## Next

[Config errors](https://jubasse.github.io/seampact/troubleshooting/config/) for the config file, or [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/) when the generated server does not start.
