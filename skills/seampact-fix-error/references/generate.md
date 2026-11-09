<!-- Generated from docs/troubleshooting/generate.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Generate errors

Page: https://jubasse.github.io/seampact/troubleshooting/generate/

`seampact generate` refuses a target option it does not know, or a form of your contract that a target does not generate yet. Each refusal has a code. Find yours in the table of your family, then follow the fix. A warning does not stop `generate`.

A refusal of a Node target reads like this:

```text
api.yaml:10: paging.sort.style.unsupported: entry 'server', api 'notes': The sort style 'pair' is not generated yet. (IR member '/pagings/springPage/request/3/style') Fix: Ask the user first: set the paging style's sort to `style: signed`, or remove the operations that use the style from `operations`. Docs: https://jubasse.github.io/seampact/troubleshooting/generate/#node-servers
```

- `api.yaml:10` is the contract line that declares the refused form, or the declaration that holds it (here the paging style). It is missing for a contract read from a bundle.
- The IR member points into the compiled contract, for a bug report.
- `Fix:` says what to change. A fix that starts with "Ask the user first:" changes the api: ask before you apply it.
- `Docs:` links the section that holds the code's row.

| Family | Section |
|---|---|
| Fetch, React, Vue, Angular, MSW | [Clients](https://jubasse.github.io/seampact/troubleshooting/generate/#clients) |
| Express, Fastify, Hono, NestJS, AdonisJS | [Node servers](https://jubasse.github.io/seampact/troubleshooting/generate/#node-servers) |
| TypeScript types, validators, clients and Node servers share the code | [Every Node target](https://jubasse.github.io/seampact/troubleshooting/generate/#every-node-target) |
| Spring Boot | [Spring Boot](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot) |
| Laravel, Symfony | [PHP](https://jubasse.github.io/seampact/troubleshooting/generate/#php) |
| FastAPI, Django REST framework, Django Ninja | [Python](https://jubasse.github.io/seampact/troubleshooting/generate/#python) |
| Spring Boot, PHP and Python share the code | [Spring Boot, PHP and Python](https://jubasse.github.io/seampact/troubleshooting/generate/#spring-boot-php-and-python) |
| Several servers share the code | [Every server](https://jubasse.github.io/seampact/troubleshooting/generate/#every-server) |
| The OpenAPI document | [OpenAPI documents](https://jubasse.github.io/seampact/troubleshooting/generate/#openapi-documents) |
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
| `artefacts.itemsOf.unsupported` | React and Vue: `itemsOf` flattens the pages of an infinite query, and `query: fetch` has none. Turn `itemsOf` off, or use `tanstack`, `swr` or `rtk`. |
| `path.param.type.unsupported`, `header.param.type.unsupported` | Fetch client: a path or header parameter that is not a scalar or an enum. Ask the user first: make it a scalar or an enum, or remove the operation from `operations`. |
| `query.style.unsupported` | Fetch client: a query value in a style other than `form`. Ask the user first: use the `form` style, or remove the operation from `operations`. |
| `input.union.headerTag.unsupported` | Fetch client: a request body whose variant is chosen by a header. Remove the operation from the client entry's `operations`: no Node target generates a union yet. |
| `error.params.shape.unsupported` | Fetch client: an error's params are not an object. Ask the user first: declare them as an object, or remove the operations that answer the error from `operations`. |
| `deprecated.unsupported`, `degradable.header.unsupported` | Fetch client: a deprecated operation, or a degraded-parts header, is not generated yet. Ask the user first: drop `deprecated` or `degradable`, or remove the operation from `operations`. |
| `format.error.body.unsupported`, `format.error.media.unsupported` | Fetch client: the error format has no top-level `code` member with merged params, or its body is not JSON. Ask the user first: use an error format with a JSON body and a top-level `code`. |
| `paging.response.headers.member.unsupported`, `paging.response.headers.text.unsupported` | Fetch client: a paging header holds more than its role (a member of it, or text around it). Ask the user first: write the header as its role alone, or remove it from the paging style. |
| `path.segment.literal.unsupported` | MSW: a fixed path segment holds `*`, or ends in `:` and digits. Ask the user first: change the segment, or remove the operation from the MSW entry's `operations`. |
| `mock.page.fact.unsupported`, `mock.envelope.member.unsupported`, `mock.error.member.unsupported` | MSW: the mock cannot fill a page fact, a success member or an error member. Remove the operation from the MSW entry's `operations`: the api does not change. Or ask the user first to use a paging style or a format the mock fills. |

## Node servers

Express, Fastify, Hono, NestJS and AdonisJS.

| Code | Cause and fix |
|---|---|
| `type.nullable.unsupported` | A property or type is `nullable: true`, and the Node servers cannot generate that (only an opaque value, which is `unknown`, may be nullable). Remove `nullable`, or make the property optional instead. |
| `options.reply.invalid` | NestJS `reply` takes `handler` or `interceptor`. Use one of them. |
| `runtime.output-directory-missing` | A programmatic generate request gave no `outputDirectory`. Pass the api's output directory; `seampact generate` always does. |
| `artefact.validators.needed` | The boundary needs validators, and the entry has no `validators` link and turns the `validators` artefact off. Link a validators entry, or add `validators` to `artefacts`. |
| `nativeDocs.requestBody.media.unsupported` | NestJS: the request body has a different schema per media type, and `@nestjs/swagger` gives one schema to a body. Ask the user first: give the body one schema, or turn `nativeDocs` off for this api. |
| `idempotency.enforce.unsupported` | The operation sets `idempotency.enforce: none`, which the Node servers do not generate. Ask the user first: keep `boundary`, or remove the operation from `operations`. |
| `paging.sortKey.restricted.unsupported` | A sort key guarded by a field right is not served. Ask the user first: leave the key out of `sortable` (a key of a restricted field inherits its right), or remove the operation from `operations`. |
| `fieldRight.nestedPointer.unsupported` | An input field right sits below the top level of the body. Ask the user first: move the right to a top-level field, or remove the operation from `operations`. |
| `access.optional.unsupported` | The operation allows a request with or without a credential (optional auth). Ask the user first: make the access required or public, or remove the operation from `operations`. |
| `paging.sort.style.unsupported` | The Node servers read only the `signed` sort style (`sort=-createdAt,title`); `pair`, `keyed` and `split` are refused. Ask the user first: set the paging style's sort to `style: signed`, or remove the operations that use the style from `operations`. |
| `paging.sort.in.unsupported`, `paging.request.in.unsupported` | A paging request role is read from a header. Ask the user first: read it from the query (`{ query: <name> }`), or remove the operation from `operations`. |
| `paging.response.header.unsupported`, `paging.response.items.unsupported` | The paging style writes a response header, or a page body that does not put `$items` under named members. Ask the user first: drop the header, or write `$items` under a named member, or remove the operation from `operations`. |
| `input.body.topLevel.unsupported`, `path.segment.mixed.unsupported` | AdonisJS: a request body that is not a plain object schema, or a path segment that mixes a parameter with text. Ask the user first: make the body an object, write each segment as a whole parameter or whole text, or remove the operation from `operations`. |
| `output.file.unsupported`, `output.opaque.unsupported`, `output.schema.unsupported` | An output value is a file or opaque, or an output schema is not an object. Ask the user first: declare an object, a list or a scalar, or remove the operations that return it from `operations`. |
| `format.several.unsupported`, `format.error.codeless.unsupported`, `format.error.headers.unsupported` | The api uses several formats, or its error format writes no `$code` or writes headers. Ask the user first: use one error format with a `$code` member and no headers. |
| `format.template.unsupported`, `format.memberName.unsupported` | The format uses a template the servers do not write, or a member name taken from a slot. Ask the user first: use a format made of slots, literals, `each` and objects with fixed member names. |
| `principal.variants.unsupported`, `scope.source.unsupported`, `signature.application.unsupported`, `signature.key.source.unsupported`, `rule.proof.placement.unsupported`, `valueSource.unsupported` | An access form the Node servers do not read yet: several principal variants, a scope id not in the path, a signature the application verifies or with its key in the request, a rule proof outside the body, or a value read from elsewhere than the path, a scope, the principal or a holder field. Ask the user first: use the supported form, or remove the operation from `operations`. |
| `principalRequires.unsupported`, `bindings.unsupported`, `upstream.unsupported`, `extensions.unsupported` | The operation uses a principal requirement (`principal: { requires: [...] }`), a binding, an upstream call or an extension value. Ask the user first: remove it from the operation, or remove the operation from `operations`. |
| `features.unsupported` | A newer seampact compiler wrote this IR. Compile the contract with the seampact release this target reads. |
| `wire.name.vinePath.unsupported` | AdonisJS: a wire name holds `.`, `[`, `]`, a quote, a backslash or a control character, which VineJS paths cannot hold. Ask the user first: rename the member to letters, digits and `_`, or remove the operations that use it from `operations`. |
| `dto.listOfLists.unsupported`, `dto.memberName.unsupported` | NestJS class-validator DTOs: a list of lists, or a member name a class cannot hold. Ask the user first: wrap the inner list in an object, or rename the member, or remove the operations that use it from `operations`. |

## Every Node target

The TypeScript types, the validators (Zod, Yup, Valibot, VineJS, class-validator), the fetch client, the MSW mocks and the Node servers share these codes.

| Code | Cause and fix |
|---|---|
| `type.nullable.unsupported`, `type.file.unsupported` | A nullable value or a file is not generated yet. Ask the user first: make the value not nullable, or remove the operations that use it from `operations`. |
| `schema.union.unsupported`, `schema.map.unsupported`, `schema.recursive.unsupported` | A `oneOf`, a map schema, or a schema that reaches itself is not generated yet. Ask the user first: write it as an object, or remove the operations that use it from `operations`. |
| `property.codeName.unsupported`, `enum.codeNames.unsupported` | A code name is not generated yet. Ask the user first: remove the `codeName` or `codeNames`. The wire does not change, but the generated names then follow the wire names, which renames the code a Spring Boot, PHP or Python target generates from the same contract. |
| `property.restrictedTo.required.unsupported` | A restricted property is required. Ask the user first: make it optional (end its name with `?`), or remove the operations that use it from `operations`. |
| `property.default.unsupported` | See [Every server](https://jubasse.github.io/seampact/troubleshooting/generate/#every-server). |
| `enum.fallback.unsupported`, `enum.narrowedTo.unsupported` | An open enum's `fallback`, or a narrowed enum, is not generated yet. Ask the user first: drop the `fallback` or use the whole enum, or remove the operations that use it from `operations`. |
| `unknownKeys.ignore.unsupported`, `unknownKeys.keep.unsupported`, `unknownQuery.ignore.unsupported` | Unknown body or query keys that are not refused. Ask the user first: remove the `unknownKeys` or `unknownQuery` exception, or remove the operations that use it from `operations`. |
| `scalar.content.unsupported`, `scalar.format.unsupported`, `scalar.named.unsupported`, `scalar.bound.inexact.unsupported` | A JSON text field, a string format, a named format, or a non-zero bound under 0.000001 in magnitude. Ask the user first: change the value's type, use 0 or a bound of at least 0.000001 in magnitude for a bound (change the unit if needed), or remove the operations that use it from `operations`. |
| `param.default.unsupported` | A parameter default is not generated yet. Ask the user first: remove the `default`, or the operation from `operations`. |
| `input.media.unsupported`, `input.proofs.unsupported`, `response.media.unsupported` | A body that is not JSON, or proof fields beside a body that is not an object. Ask the user first: use a JSON object body, or remove the operation from `operations`. |
| `response.header.unsupported` | A response header written by the route. Ask the user first: remove the header, or the operation from `operations`. |
| `query.wire.unsupported` | A query parameter that is not a scalar, an enum or a list of them in the `form` style. Ask the user first: change the parameter, or remove the operation from `operations`. |
| `wire.outputEnums.open.unsupported` | `conventions.outputEnums: open` is not generated yet. Ask the user first: set it to `enum`. |
| `wire.urls.absolute.unsupported` | The pages and links of a list are written as absolute URLs, which the client, the mocks and the Node servers do not read yet. Ask the user first: set `conventions.urls` to `relative`. |
| `wire.name.yupPath.unsupported` | Yup: a wire name holds `[`, `]` or `"`, which Yup's issue path cannot carry. Use another validator target, such as Zod. Or ask the user first to rename the member. |
| `artefact.unknown` | The entry switches an artefact the target does not declare. Remove it from `artefacts`, or use one of the ids the message lists. |
| `export.name.duplicate` | Two declarations give the same generated name in one module. Rename one of them in the contract. |
| `errorCode.key.duplicate`, `status.reasonPhrase.unknown` | Two error codes give the same `ErrorCode` key, or a status is not in the IANA registry. Ask the user first: rename one code, or answer with a registered status. |
| `schema.ref.unresolved`, `enum.ref.unresolved`, `format.unresolved`, `scheme.unresolved`, `identity.unresolved`, `error.unresolved`, `paging.style.unresolved`, `schema.direction.missing`, `response.body.missing`, `response.page.style.missing`, `query.wire.missing`, `paging.defaultLimit.missing`, `paging.response.meta.unplaced`, `operation.table.idProperty.missing`, `header.name.duplicate`, `error.code.undeclared`, `error.code.words`, `format.success.shape`, `scheme.signature.header`, `concurrency.etag.field`, `scalar.pattern.misplaced`, `scalar.multipleOf.misplaced`, `scalar.multipleOf.notPositive`, `scalar.length.misplaced`, `scalar.bound.misplaced`, `ir.deprecation.headers`, `ir.deprecation.since`, `ir.deprecation.successor`, `ir.concurrency.version.name` | The IR breaks a rule the compiler guarantees, so seampact did not write it. Compile the contract again with the same seampact release as the targets. |

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
| `urls.absolute.unsupported` | `conventions.urls: absolute` is not generated yet. Ask the user first: set `conventions.urls` to `relative`. |
| `error.noStore.unsupported` | An error whose params carry a sensitive value forbids caching, which is not generated yet. Ask the user first: drop `sensitive` from the values in the error's params, or remove the operations that answer the error from `operations`. |
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
| `enum.open.unsupported`, `enum.narrowed.unsupported`, `unknownKeys.keep.unsupported`, `paging.handlerResult.unsupported` | An open or narrowed enum, kept unknown keys and some paging facts are not generated yet. Remove the operation from `operations`. |
| `param.path.structured.unsupported`, `param.header.structured.unsupported`, `param.default.unsupported`, `member.default.unsupported` | A path or header parameter that is not a scalar or an enum, and a default value, are not generated yet. Remove the operation from `operations`. |
| `path.param.type.unsupported` | A path parameter is not a string, a number or an enum. Remove the operation from `operations`. |
| `path.segment.literal.unsupported`, `path.segment.mixed.unsupported` | A fixed path segment holds `{`, `}` or `?`, or a segment mixes a parameter with text. Write each segment as a whole parameter or whole text. |
| `path.param.missing`, `name.segment.missing` | The IR is not one seampact wrote. Compile the contract again with the same seampact release, or update the target. |
| `name.collision` | Two schemas, members or errors give the same Python name. Rename one in the contract, or give one a `codeName`. |
| `principalRequires.unsupported`, `bindings.unsupported`, `upstream.unsupported` | The operation uses an access or relay form the Python targets do not generate yet. Remove the operation from `operations`. |
| `features.unsupported` | A newer seampact compiler wrote this IR. Compile the contract with the seampact release the Python targets read. |

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
| `unknownKeys.keep.unsupported` | Kept unknown keys are not generated yet. Remove the operation from `operations`. |
| `extensionKeys.unsupported` | The api declares typed extension keys, which are not generated yet. Removing operations does not clear it. Ask the user first: remove the api's `extensions` declarations and the extension values that use them. |
| `options.handlers.unsupported`, `options.naming.unsupported` | `handlers` is `perResource` only, and the naming options (`suffixes`, `perOperation` and the like) are not options of these targets. Remove the option. |

## Every server

Codes several servers share. The cause names the servers it applies to.

| Code | Cause and fix |
|---|---|
| `format.success.envelope.unsupported`, `format.success.slot.unsupported`, `format.success.headers.unsupported`, `format.meta.unsupported` | Node servers, Spring, Laravel and Symfony: the format pack writes an envelope, slot, success header or meta member the server cannot write. Ask the user first: use a format whose envelope puts `$payload` under named members, with no meta member and no success header, or another server. |
| `paging.response.slot.unsupported` | The page writes a slot the server does not fill: `$resource`, `$collection`, an item's id or URL, or `$page` under an offset style. Ask the user first: use a paging style whose page writes only its response roles, or remove the operation from `operations`. |
| `format.self.member-route` | PHP servers: the format or paging style writes a member URL (`$itemSelf`, or `$self` on an item) for an operation whose resource has no member route to build it from: a get through its id parameter whose parent path the operation's path starts with, with the same parameter names. Ask the user first: declare that member route, move the operation under it, or write the format without the slot. |
| `paging.sortKey.right.unsupported` | Spring Boot, PHP and Python: a sort key guarded by a field right is not served. Leave the key out of `sortable`, or remove the operation from `operations`. |
| `scheme.query.unsupported`, `scheme.basic.unsupported`, `scheme.signature.unsupported` | The servers read a credential from a bearer token, a cookie or a header only. Ask the user first: use a `bearer`, `cookie` or `header` scheme, or remove the operation from `operations`. |
| `degradable.unsupported` | Node servers, Spring, Laravel and Symfony do not generate `degradable` operations yet. Ask the user first: remove `degradable`, or the operation from `operations`. |
| `concurrency.etag.withoutWrite.unsupported` | A read writes an `ETag` for a resource whose `If-Match` writes sit in another api, so the server has no field to read the version from. Ask the user first: serve the read and its writes in one api, or remove the read from `operations`. |
| `deprecated.successor.otherApi.unsupported` | A deprecated operation names a successor in another api, whose URL the server cannot write in its `Link` header yet. Ask the user first: name a successor in the same api, or drop the successor. |
| `identity.response.header.unsupported` | The identity declares a response header (a `versionToken`, or one declared `in: response`) that no server writes yet. Ask the user first: remove the operations under that identity from `operations`. For a header other than a `versionToken`, you may instead declare it `in: request`. |
| `right.extensions.unsupported`, `rule.extensions.unsupported`, `scope.extensions.unsupported` | Node servers, Spring, Laravel and Symfony: the decide and resolve requests do not carry custom metadata yet. Ask the user first: remove the `extensions` of that right, rule or scope, or the operations that use it from `operations`. |
| `property.default.unsupported` | Every Node target, Spring, Laravel and Symfony: a body member's default is not filled, so the handler would receive it absent. Ask the user first: remove the `default`, or the operations that use the schema from `operations`. |
| `param.query.structured.unsupported` | PHP and Python: a query parameter that is not a scalar, an enum or a list of them in the `form` style (an object, a list of lists, `deepObject`) is not read yet. Make the param a scalar, an enum or a list of them, or remove the operation from `operations`. |
| `query.list.brackets.unsupported` | The fetch client and every server: a list sent as `tag[]=a&tag[]=b` is not read yet. Ask the user first: set `conventions.query.lists` to `repeat` or `comma`. |
| `response.shape.unsupported` | The fetch client, Node servers, Spring, Laravel and Symfony do not generate download or redirect responses yet. Ask the user first: remove the operation from `operations`. |
| `path.segment.encoded.unsupported` | A fixed path part has a space, a control or non-ASCII character, or one of `"` `<` `>` `^` `\` `{` `}` `|` `[` `]` or a backtick, which a client would send percent-encoded. Ask the user first: use plain ASCII letters, digits and `-` in that part. |
| `artefacts.accessHooks.unsupported` | Laravel, Symfony, FastAPI, DRF and Ninja: `accessHooks: false` (native access) is not generated yet. Keep the hooks, and read the framework's own auth in the authenticate hook. |
| `artefacts.bootCheck.hooks.warn.unsupported`, `artefact.bootCheck.hooks.warn.unsupported` | PHP, Python and Spring Boot (`artefact.` there): starting with a hook missing (`warn`) is not generated yet. Use `error` (the default) or `off`. |
| `runtime.missing` | Node servers and Spring: the app does not install the runtime. Install `@seampact/server-runtime` (Node) or add `seampact-spring-runtime` (Maven; the Gradle plugin adds it) at the generator's version. |
| `runtime.version-mismatch` | Node servers and Spring: the installed runtime has another `major.minor`, or an older patch, than the generator. Install it at the generator's version; a later patch passes. With Gradle, remove the BOM or forced version that overrides the plugin's. |
| `runtime.generated-for-other-version` | See [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/). |

## OpenAPI documents

The OpenAPI document `generate` writes for an api refuses these forms.

| Code | Cause and fix |
|---|---|
| `openapi.example.request.unsupported`, `openapi.example.error.unsupported`, `openapi.example.status.unsupported`, `openapi.example.shape.unsupported`, `openapi.example.empty.unsupported`, `openapi.example.slot.unsupported`, `openapi.example.template.unsupported`, `openapi.example.merge.unsupported`, `openapi.example.member-name.unsupported` | An example the document cannot place or write. Remove the example: it changes only the document. |
| `openapi.template.array.unsupported`, `openapi.template.each.unsupported`, `openapi.template.slot-path.unsupported`, `openapi.template.slot.unsupported`, `openapi.template.member-name.unsupported`, `openapi.template.member-repeated.unsupported` | The format uses a template the document cannot describe. Ask the user first: for `array`, write the list with `$each`; for `each`, make `$each` read a list slot and write its `$as`; for `slot-path`, write the whole slot (`$x`), not one of its members (`$x.y`); for `slot`, use a slot the format defines in that place; for `member-name`, give the member a fixed name; for `member-repeated`, write each member once. Or leave the api out of the app's `openapi` map (`openapi: none` writes no document). |
| `openapi.format.error.headers.unsupported`, `openapi.format.success.headers.unsupported`, `openapi.error.formats.unsupported`, `openapi.paging.headers.unsupported` | Headers written by a format or a paging style, or an error answered in several formats. Ask the user first: drop those headers, or answer the error in one format. |
| `openapi.scheme.bearer.unsupported`, `openapi.sensitive.shape.unsupported`, `openapi.input.brackets.unsupported`, `openapi.response.shape.unsupported` | A bearer scheme with both OAuth 2 flows and an OpenID Connect URL, a sensitive value that is not a scalar, a form field named with brackets, or a download or redirect. Ask the user first: change that form, or remove the operation from the document's operations. |
| `openapi.enum.missing`, `openapi.error.missing`, `openapi.error.provenance`, `openapi.format.missing`, `openapi.input.field-wire`, `openapi.input.file`, `openapi.input.proofs`, `openapi.page.style`, `openapi.paging.style`, `openapi.response.body`, `openapi.response.status`, `openapi.schema.missing`, `openapi.scheme.missing`, `openapi.signature.header`, `openapi.value-source.name` | The IR breaks a rule the compiler guarantees, so seampact did not write it. Compile the contract again with the same seampact release as the targets. |
| `openapi.options.invalid` | A document's `extensions`, `reasons`, `inputSchemas` or `servers` in the config's `openapi` map is not a value it takes. Fix the value the message names. |
| `openapi.merge.empty`, `openapi.merge.prefix-api`, `openapi.merge.prefix-invalid`, `openapi.merge.unknown-document` | A merged document of the root config covers no api, sets a prefix for an api none of its apps gives or with characters a component key refuses, or names a document the api does not declare. Follow the fix the message gives. |
| `openapi.merge.api-versions`, `openapi.merge.route-clash`, `openapi.merge.name-clash` | Two apps of a merged document give different versions of one api, two routes answer the same method and path, or two elements share a name. Build the apps from one version of the api, give the routes distinct paths, or set a `prefix` for one of the apis. |

## Warnings

| Code | Cause and fix |
|---|---|
| `identity.headers.handler` | The identity declares request headers (deadline, trace) and the boundary only checks they are well formed. Your handler reads them. Silence it with `warnings.ignore: [identity.headers.handler]` once it does. |
| `validators.artefact.ignored`, `options.rules.ignored` | The entry links validators and also lists the `validators` artefact or the `rules` option, which then shape nothing. Drop the artefact or the option, or drop the link. |
| `paging.infinite.skipped` | The list gets no infinite query, because its paging style does not tell the next page. Use the plain query with the position parameter, or add a next-page fact to the paging style. Silence it with `warnings.ignore: [paging.infinite]`. |

## Next

[Config errors](https://jubasse.github.io/seampact/troubleshooting/config/) for the config file, or [Boot errors](https://jubasse.github.io/seampact/troubleshooting/boot/) when the generated server does not start.
