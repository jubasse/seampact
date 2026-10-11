# ADR 0002: Authoring grammar

Status: accepted

## Context

A contract is written in YAML only (brief section 1). The grammar is the decision hardest to change later: every contract, the authoring JSON Schema, the loader, the compiler passes and the editor experience depend on it. Brief section 5.3 gives a first sketch and asks for the final grammar with a reason for each departure (open question 1 of section 18).

This ADR fixes every keyword a contract file may contain, outside the inside of a schema. The schema language itself (JSON Schema keywords kept and refused, direction, unions, marks such as `sensitive` and `restrictedTo`) is ADR 0003; this ADR only says where a schema may appear. What the compiler makes of the tree is the IR (ADR 0004) and the pass pipeline (ADR 0006). What a convention pack may set, and how packs and packages are resolved, is ADR 0008; this ADR defines the keywords they use.

Forces:

- One fact, one place (lesson 1). A grammar that lets the same fact be written twice needs a gate to hold the copies together.
- Deny by default, and a reason on every exception (brief section 7, FR-4).
- Nothing ahead of use (lesson 5): a keyword exists only if a checklist item or an amendment needs it.
- The core imposes nothing (A36, after A20, A25, A30): no header name, error code, right name, envelope, page shape, wire format, versioning scheme, query encoding or implementation. Where the compiler needs a value to work, it has a default the contract can rename or replace, and everything else comes from the contract's base file or from opt-in convention packs. What the grammar does demand is explicitness: every route states its access, every exception its reason.
- Inline and included content must compile to the same bytes (FR-1, FR-9).
- The YAML must mean the same thing to every parser, in every language (FR-1).

## Options

1. Keep the sketch of section 5.3 as written.
2. Replace it with an OpenAPI-like flat list of paths and operations.
3. Keep the sketch's model (a tree mirroring the URL, catalogues of named declarations, `ops` shorthand, `requires`) and change what does not hold up once rights, scopes, signed webhooks, several apis and A30 are added.

Option 1 does not cover A18 to A25 (rights, scopes, neutral hooks) or A5 (signed webhooks), and some of its forms are ambiguous (children of a `single` mixed with settings keywords; `requires` items that cannot tell a right from a rule). Option 2 loses inheritance, which is what lets a contract state an identity, a scope or an error once for a whole subtree (brief section 5.2). Option 3 is chosen. Each departure from the sketch is listed with its reason in "Departures from brief 5.3".

## Decision

### 1. Files and the workspace

A contract workspace is a directory of YAML files with one entry file, `workspace.yaml`; the workspace root is that file's directory. A workspace with a single api may omit it; the CLI then takes the api file directly, and the root is the api file's directory. A contract whose files reach above that directory (`extends: ../shared/base.yaml`) needs a `workspace.yaml` at or above every file it reads.

```yaml
# workspace.yaml
workspace:
  apis:
    tasks: ./tasks/api.yaml
    tasksService: ./tasks-service/api.yaml
  shared: ./shared/base.yaml
  imports:
    storefront: { package: '@acme/contracts', version: 2.3.0, api: storefront, integrity: sha256-Qm9vY... }
```

- `workspace.apis` maps each api name to its api file. The names must equal each file's `api.name`. All apis of a workspace compile together, which is how `relays` reaches a sibling api (FR-8).
- `workspace.shared` names a file with the keys of a base, which every api of the workspace builds on, before its own base (section 2). It holds what several apis share: schemes, identities, common schemas, and the rights and scopes their field marks name.
- `workspace.imports` names an api held in a pinned contract bundle, so a `relays` can target it without its sources. An entry takes one source form of the app config's `sources` (ADR 0011: `package` with `version`, `release`, or `git`), `api`, the api's name inside the bundle, and `integrity`, which is required. The bundle passes ADR 0011's pinned-bundle check before its IR is read; a missing `integrity` fails and prints the actual value, so pinning is a copy.

There are five kinds of file. The loader knows each by its top-level keys.

| File | Top-level keys | Reached by |
|---|---|---|
| workspace | `workspace` | the CLI |
| api | `api`, `extends`, `packs`, `surfaces`, any catalogue, `conventions`, `formats`, `extensions`, `lint` | `workspace.apis` |
| base | any catalogue, `packs`, `conventions`, `formats`, `extensions` | `extends` from an api, or `workspace.shared` |
| pack | `pack`, any catalogue, `conventions`, `formats`, `extensions`, `derive` | `packs` from an api or base, `extends` from a pack |
| fragment | whatever the include site expects | `$include` or a file `$ref` |

The catalogues are `schemas`, `enums`, `scalars` (named formats, ADR 0003 section 8), `errors`, `natures` (error natures, section 11), `schemes`, `headers` (identity headers, section 9), `identities`, `rights`, `rules`, `requirements` (named requirement items, section 9), `scopes`, `buckets`, `services` and `pagings` (section 14). `formats` (section 13) is keyed by name like a catalogue. Each maps a name to one declaration. Everything a contract references by name lives in one of them.

Paths in `extends`, `packs`, `$include`, `$ref` and `$file` are relative to the file that contains them, use forward slashes, must stay inside the workspace root, and must match the case of the file on disk. The last two rules keep compilation identical on case-insensitive file systems and stop a contract from reading files outside its repository.

### 2. Composition: `extends`, `packs`, `$include`, `$ref`, `$file`

- `extends: ./base.yaml`. An api extends at most one base. The base's catalogues, conventions, formats and extensions join the api's. A base does not extend another base: what every api shares goes in the workspace's shared file (section 1), and anything beyond travels as packs. A name defined in both the api and its base is an error naming both locations, even when the two definitions are identical (fix: "remove the copy", SCN-029).
- `packs: ['@seampact/pack-crud-rights', ./packs/house.yaml]`. A list of convention packs, applied in order (below). A string starting with `./` or `../` is a path; any other string is a package name, resolved from the nearest `package.json` at or above the workspace root (ADR 0008). The first-party packs are also embedded in the standalone binary, which uses its copy when no package resolves. A pack is data only: a pack file containing anything but the keys of the table above is refused (SCN-047).
- `$include: <path>` or `$include: [<path>, ...]` is organisational. It may appear as a key of any mapping except a mapping of named tree nodes (`routes`). Each included file holds a mapping, which is merged in place into the mapping that holds `$include`: its keys take the position of the `$include` key, in the file's order, several files in list order. A path may end with a fragment, `#` and a JSON Pointer into that file, to include one mapping inside it (`./schemas/task.yaml#/Task`). A key defined twice, by two files or by a file and a sibling key, is a duplicate-key error. An included schema is an inline copy at the include site, not a reference (SCN-030).
- `$ref` names an addressable element and keeps its identity: the IR holds one copy and every use points to it (SCN-030). Its value is a name (`Task`) or a file (`./schemas/task.yaml`, or `./schemas/task.yaml#/Task`). A fragment after a file path is a JSON Pointer into that file. A file `$ref` without a fragment is valid when that file declares exactly one element of the expected catalogue, under its name. A file reached only through `$ref` adds the referenced element, and the elements it references in turn, to the api; its other declarations are not added. A name used inside that file resolves among the names its layer sees (below) and the file's own declarations, and an element found in the file is added with the one that uses it; a name found in both is a compile error naming both. A file both `$include`d into a catalogue and reached by `$ref` is declared once, by the include, and the `$ref` points at the included element. A pointer into the merged catalogues (`'#/schemas/Task'`) is refused: the name says the same thing.
- Schema files are always name-keyed: they map names to schemas (`Task: {...}`), whether reached through `$ref`, through `$include` under `schemas`, or through a fragment. One file therefore serves both uses of SCN-030:

```yaml
# tasks/api.yaml (excerpt: two route settings)
output: { $ref: ./schemas/task.yaml }            # the element Task, shared
input: { $include: ./schemas/task.yaml#/Task }   # an inline copy of Task's body
```

- Every loader directive (`$include`, `$ref`, `$file`) starts with `$`, which no name pattern admits, so a directive never collides with a field, property, parameter, header or catalogue name: `query: { include: { type: string } }` declares a query field named `include`. In data positions (`value`, `example`, `examples`, `default`), only a mapping whose sole key is `$file` is processed; any other mapping, one holding `$ref` or `$include` included, is data.
- In a position that expects a schema, a plain string is a `$ref`: `output: Task` means `output: { $ref: Task }`. The `$ref` form is written only when siblings sit beside it (ADR 0003 section 6) or to name a file. Other references are names in typed positions (`identity: user`, `right: tasks.update`, `errors: [api.forbidden]`, `enum: Role`), so they need no `$ref`.
- `$file: <path>` replaces the value that holds it with a file's content: a `.md` or `.txt` file gives a string (docs), a `.json` or `.yaml` file gives data (examples). A `.yaml` file read this way goes through the same pitfall checks as any contract file. A missing file is a located error (SCN-088).

#### Packs

```yaml
# @seampact/pack-crud-rights/pack.yaml
pack: { name: '@seampact/pack-crud-rights', version: 1.0.0, extends: [] }
derive:
  - entry: crud
    select: { op: [list, get, create, update, delete] }
    declareRight:
      name: '{resource}.{op}'
      subject: { member: resource, collection: innermostScope }
    require: { right: '{resource}.{op}' }
```

```yaml
# packs/house.yaml (excerpt)
pack: { name: house, version: 2.1.0, extends: ['@seampact/pack-crud-rights'] }
conventions:
  rights: { pattern: '^[a-z]+(\.[a-z]+)+$' }
```

`pack` is the manifest: `name` (the package name, or for a pack referenced by path a name of the contract's choosing), `version` (semver) and `extends` (packs applied just before this one, in the reference forms of `packs`). The version is written once, in the manifest: for a pack resolved from a package, the compiler refuses a `package.json` whose version differs.

`derive` is the only way a pack adds to what a route ends up with (ADR 0008). It is a list of entries, applied in order; each has an `entry` name, unique in the pack, a selector and one or more effects, all from closed sets:

| Key | Meaning |
|---|---|
| `select` | criteria a route must all match, each a list of accepted values: `op` (`list`, `get`, `create`, `update`, `delete`, `batch`: the `ops` name the route came from), `access` (`read` for a safe route, `write` otherwise), `apiKind` (`product`, `service`), `identity`, `tag` |
| `declareRight` | `{ name, subject, errors }`: declares the right the `name` template gives. `subject.member` (on member routes) is `resource`, the item schema with the member id, or `none`; `subject.collection` (on other routes) is `innermostScope` or `none`. When the catalogue already declares that name, the declared right is used and its subject must be the one the entry would give |
| `require` | `{ right: <template> }` or `{ rule, params, bucket }`: a requirement attached to the route (section 8 gives its position) |
| `attachErrors` | codes attached to the route |

Templates in `derive` use `{resource}`, the name of the collection or single the route belongs to (`tasks`), and `{op}`, the `ops` name, or the route's name for a route that did not come from `ops`. Every element an entry produces carries `derivedFrom` naming `pack.<pack>.<entry>` (ADR 0006).

A contract's own derivations go in a local pack, referenced by path, since a base holds no `derive`; it declares the codes it attaches, because a pack sees only itself and the packs it extends (below):

```yaml
# packs/plank.yaml: a local pack, applied with packs: [./packs/plank.yaml]
pack: { name: plank, version: 1.0.0, extends: [] }
errors:
  workspace.plan_limit_reached: { status: 409, title: 'The workspace plan allows no more of these.' }
derive:
  - entry: planLimit
    select: { op: [create] }
    attachErrors: [workspace.plan_limit_reached]
```

`conventions.rights.pattern` is the right-naming setting of ADR 0008: a regular expression that every right name, declared or derived, must match besides the core pattern of section 4.

#### Layers and overrides

An api's declarations and settings come from layers applied in this order: the shared file's packs, the base's packs and the api's packs, each in their order, then the shared file, the base and the api. A pack's `extends` are applied just before it. A pack reached twice is applied once, at its first position; a cycle of `extends` is an error naming the cycle.

A layer resolves names only in itself and the layers it builds on, so it compiles the same for every api that uses it. A pack sees itself and the packs it extends; the shared file sees itself and its packs; a base sees itself, its packs, the shared file and the shared file's packs; an api sees everything. A base extended by two apis therefore never depends on what one of them declares: a name a base or the shared file uses but only an api declares is a compile error naming the name, the file and the fix (move the declaration into the shared file or the base).

- Declarations (a catalogue entry, a format, a paging style, a `derive` entry) are never overridden: one name declared by two layers is an error naming both locations, even when the two are identical (SCN-029). An attachment may override an error's example only (section 11).
- Settings (`conventions`) are overridden by leaf path. A leaf is a scalar, or a list taken as one value; `errors.every` is the exception, a union of every layer's list. Maps of named entries (`cache.families`, `errors.derived`) merge per entry, each entry being a leaf. An api writing `paging: { maxLimit: 50 }` therefore keeps a pack's `paging.default`.
- A later layer wins, and the IR records the origin of every leaf (ADR 0004). A base shared by several apis can thus be overridden by one of them; an override states a different value, not a second copy of the same fact.

#### The byte-identity rule

A route declared inline and the same route moved to a file reached through `$include` compile to byte-identical IR (FR-1, FR-9, SCN-001). The grammar guarantees it with five rules:

1. The IR never depends on which file a node came from, nor on the order of keys in a mapping, with one exception: the members of a generated type (`properties` of an object schema, and fields maps) keep their written order, so generated code lists fields as the author wrote them (A33). `$include` never reorders anything: its keys take its position. Order is otherwise meaningful only in sequences; ADR 0004 lists the sequences whose order the IR keeps (`requires`, `upstream`, enum `values`, among others) and sorts every other sequence as a set.
2. `$include` replaces itself with the file's mapping before any other step; after it, the tree is the same as if the content had been written inline.
3. Relative paths inside an included file resolve against that file, so moving content and fixing its relative paths reaches the same files; the IR stores the content of `$file` and `$ref` targets, never a path.
4. Names that the compiler derives (operation ids, inline schema names, ADR 0007) come from the position in the tree and the role, never from a file name.
5. Source locations (file, line, column) live only in the side table (ADR 0004). An element's `origin` in the IR is a logical path in the tree, such as `surfaces.app.routes.channels.member.routes.tasks`, which does not change when content moves between files.

The loader's property test externalises random nodes of generated trees and asserts byte equality of the IR.

### 3. YAML subset and refused pitfalls

Files are parsed as YAML 1.2 with the core schema, then checked against the authoring JSON Schema (FR-9). The loader refuses, each with file, line, column, rule and fix (FR-1, SCN-002):

| Rule | Refused | Examples | Fix |
|---|---|---|---|
| P1 | a plain scalar that YAML 1.1 reads as a boolean, or a boolean not in lowercase | `y`, `n`, `yes`, `no`, `on`, `off` (any case), `True`, `FALSE` | quote it, or write `true` or `false` |
| P2 | a plain number not written in plain decimal | `012` (octal in 1.1, 12 in 1.2), `0o12`, `0x1F`, `+1`, `1e3`, `.5`, `1.`, `.inf`, `.nan` | quote it, or write the number in plain decimal |
| P3 | a plain scalar that YAML 1.1 reads as a number or a timestamp and 1.2 as a string | `1_000`, `0b101`, `1:30` (sexagesimal), `2027-06-30`, `2027-06-30T10:00:00Z` | quote it |
| P4 | a plain `=` or `<<` | `=` (a 1.1 value key), `<<:` | quote it |
| P5 | an anchor, an alias or a merge key, anywhere | `&base`, `*base`, `<<:` | use `$ref` or `extends` |
| P6 | a scalar whose type differs from the one the authoring schema expects, null included | `version: '1'`, `name: 12`, `summary: ~`, `summary:` with no value | write the expected type |
| P7 | a duplicate key | two `tasks:` in one mapping, or once inline and once through `$include` | remove the duplicate |
| P8 | a cycle of `$include`, `extends` or pack `extends` | `a.yaml` includes `b.yaml`, which includes `a.yaml` | break the cycle |
| P9 | more than one document in a file, or a tag | `---` twice, `!!str` | one document per file; no tags |

The loader applies P1 to P4 to every plain scalar (keys and values) with these expressions, so the loader lane implements an exhaustive list, not examples:

- P1: `^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|True|TRUE|False|FALSE)$`.
- P2: a scalar that the YAML 1.2 core schema resolves to an integer or a float and that does not match `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.
- P3: the YAML 1.1 int, float and timestamp expressions that the 1.2 core schema does not match: `^[-+]?(0b[01_]+|0[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?|[0-9][0-9_]*_[0-9_]*|([0-9][0-9_]*)?\.[0-9_]*_[0-9_]*)$` and `^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ]|$)`.
- P4: `^(=|<<)$`.

In data positions (examples), null is written `null`; `~`, `Null`, `NULL` and an empty value are refused there too. A `$ref` resolves by name, so a cycle through it is a recursive schema, which is legal and independent of the file layout (ADR 0003 section 2).

No keyword of the grammar is a word that YAML 1.1 reads as a boolean (`on`, `off`, `yes`, `no`), so a keyword never needs quoting. Prose is another matter: in a flow mapping (`{ ... }`), a plain value ends at `, ` or `: `, so `{ title: No such workspace, or not a member. }` holds two keys. Quote prose (`title`, `summary`, `reason` and every docs string) in a flow mapping, or write it in block style; the examples of the ADRs do. A plain mapping key is a string, except in a mapping keyed by HTTP status (`responses`), where keys are plain integers from 200 to 299: only success responses are written. Error statuses come from codes (section 11), 304 is derived from `cache.etag`, and other 3xx responses are not modelled until a consumer needs them.

One comment has a meaning, to editors only: the modeline, the first line of every contract file, fragments included (FR-9, SCN-046). `@seampact/spec` publishes an authoring schema per file kind (workspace, api, base, pack) and per fragment kind, that is, per mapping an include site may expect: a tree node, a name-keyed catalogue file (`schemas`, `errors`, `rights` and the other catalogues), a node's `errors` map, `conventions`, a schema. A fragment's kind is the one its include site expects. `seampact init` writes the modeline of each file it creates, and `seampact init --modelines` writes or corrects the modeline of every file of an existing workspace, taking each fragment's kind from its include site.

Those schemas check keywords only. `seampact compile --editor-schemas` checks names too: it writes to `.seampact/schemas/` the same schemas specialised for the workspace, where every position that names a declaration (`identity`, `right`, a `requires` entry, `enum`, an error code, `paging`, a schema reference) lists the names the workspace declares, each described by the file and line that declares it. An editor then flags a misspelt name and offers the declared ones as you type; `compile --watch` keeps them current. `init` writes them once, adds `.seampact/` to `.gitignore`, and points the modelines there, relative to each file; a fresh checkout runs `compile --editor-schemas` once. A modeline may point at the installed `@seampact/spec` instead, which checks keywords only. No language server is needed for this; go-to-definition and rename wait for a consumer that asks (lesson 5). The included route of the worked example, `tasks/routes/tasks/search.yaml`, would start:

```yaml
# yaml-language-server: $schema=../../../.seampact/schemas/node.schema.json
method: post
requires: [{ right: tasks.reed }]   # flagged: the right must be one of callerService, roles, tasks.read, tasks.seeEffort, tasks.update
```

### 4. Scalars, names and value sources

- Durations: an integer followed by `ms`, `s`, `m`, `h` or `d` (`300ms`, `15m`, `24h`). Sizes: an integer followed by `B`, `KiB` or `MiB` (`1MiB`). Dates: a quoted ISO 8601 date (`'2027-06-30'`); unquoted it is a YAML 1.1 timestamp and refused.
- Reasons: a non-empty string. Every exception takes one (section 9).
- Name patterns, checked by the authoring schema:

| Element | Pattern | Examples |
|---|---|---|
| schemas, enums | `^[A-Z][A-Za-z0-9]*$` | `Task`, `TaskId` |
| apis, surfaces, tree nodes, operation ids, identities, schemes, headers, scopes, rules, requirements, buckets, services, natures, wire formats, paging styles, pack entries, cache families, documents | `^[a-z][A-Za-z0-9_]*$` | `tasks`, `viewer_or_device`, `five_minutes` |
| scalars (named formats) | `^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*$` | `money`, `iri-reference` |
| rights | any non-empty string without control characters and without leading or trailing space | `roles`, `tasks.update`, `read:tasks`, `update-post`, `ROLE_ADMIN`, `edit articles` |
| error codes | `^[A-Za-z0-9][A-Za-z0-9._-]*$` | `api.forbidden`, `state.conflict`, `TASK_NOT_FOUND`, `E1042`, `not-found` |
| extension prefixes | `^[a-z][a-z0-9]*$`, `seampact` reserved | `acme` |
| extension keys | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` | `tax-basis`, `invalidates` |

  Right names and error codes are wire and library values, so the core asks no more of them than it must (A20, A36). A right takes the name the application's library already uses: an OAuth scope, a Laravel Gate, a Spring authority, a spatie permission; a name holding a space or a `:` followed by a space is quoted in YAML. An error code is the value every format sends and also the name of its OpenAPI component, whose keys OpenAPI 3.1 limits to letters, digits, `.`, `-` and `_`: hence its alphabet. A URI-shaped problem `type` is a format template over the code (section 15), not a code. The core imposes no naming convention on either (SCN-063); `conventions.rights.pattern` and `conventions.errors.pattern` add one when a contract or a pack wants it (section 13). Two rights or two codes whose identifier segments are equal (`not-found` and `not_found`) are a compile error, as for any name (ADR 0007). An error's family is its `family` key, or else its code up to the first dot; a code without a dot and without `family` has none (FR-6).
- A fields map maps names to schemas. A field is required unless its name ends with `?`: `query: { limit?: { type: integer }, cursor?: Cursor }`. A fields map has no `required` keyword and a schema has no `?` suffix, so each place has one way to say it. Fields maps are used for `id`, `pathParams`, `query`, `headers`, and the `params` of errors, rights and rules. In each of these places a string instead of a mapping names a schema whose properties are the fields (`query: TaskQuery`).
- Value sources name where a value is read. One grammar serves every use; each use accepts a subset:

| Source | Meaning |
|---|---|
| `path.<param>` | a path parameter |
| `query.<param>` | a query parameter |
| `header.<Name>` | a request header (case-insensitive) |
| `body.<field>[.<field>...]` | a field of the parsed body |
| `principal.<field>[.<field>...]` | a field of the authenticated principal |
| `scope.<scope>` | a resolved tenancy scope |
| `host`, `subdomain` | the request host, or its first label |
| `address`, `address/<bits>` | the client address, or its prefix (`address/64`) |
| `resolver` | an application-implemented resolver (scopes only) |

| Use | Accepted sources |
|---|---|
| requirement `subject` | path, query, header, principal, scope (never body: rights are decided before body validation, FR-5) |
| scope id (`scopes` on a node) | path, query, header, host, subdomain, principal, resolver (A23) |
| `bindings` key / value | path, query, body / principal |
| `concurrency.version` | body, query, header (`header.If-Match` reads a strong entity tag) |
| bucket `key` | address, address prefix, principal, body |
| signature `key` | path, query, header |
| union `discriminator.from` | header (a route's whole input, ADR 0003 section 3) |

### 5. The api file

```yaml
# tasks/api.yaml (excerpt)
api:
  name: tasks
  version: 1
  kind: product
  maturity: provisional
  summary: Tasks shared inside channels.
  description: { $file: ./docs/api.md }
  compat: { policy: additive-only }
  documents:
    public: { internal: exclude }
    full: {}
extends: ./base.yaml
```

| Key | Meaning |
|---|---|
| `name` | the api name, unique in the workspace |
| `version` | an integer; the path version derives from it (section 6) |
| `kind` | `product` (default: an api for end users and their clients) or `service` (an internal api with a caller identity, below) |
| `pathVersion` | `{ omit: "<reason>" }` to keep `/v{version}` out of every surface's path (section 6); by default the path carries the version |
| `role` | `gateway`: every route derives 502, 503 and 504 from the `upstreamUnavailable`, `serviceUnavailable` and `upstreamTimeout` roles (FR-34) |
| `caller` | service apis only: `{ identity, right }`; see below |
| `maturity` | `experimental`, `provisional` or `stable`; the default maturity of every operation |
| `compat` | `{ policy: additive-only }` or `{ policy: none }`; gates releases and `maturity: stable` (FR-13, SCN-019, SCN-050) |
| `documents` | the OpenAPI documents to emit; see below |
| `summary`, `description` | docs; `description` may be a `$file` |

A service api (FR-8, section 9 of the brief) states `caller: { identity: service, right: callerService }`. Every route of it runs under that identity, which its surfaces need not repeat and no node may change; a public or optional-auth route is a compile error; a route whose `requires` does not include `caller.right` is a compile error (SCN-014, SCN-045). The names are the contract's own (A20): the core knows only that this api has a caller identity and a caller right.

`documents` declares named OpenAPI documents. Each entry takes `surfaces` (the surfaces it covers, default all) and `internal` (`include`, the default, or `exclude`). An api with no `documents` emits one document holding every route (SCN-044). Where each document is written is app configuration (ADR 0011); what each IR member becomes in it, natively or as an `x-seampact-*` extension, is ADR 0004 section 12.

### 6. Surfaces and the tree

`surfaces` maps a surface name to the root node of a tree. A surface is a named entry point with a path prefix and, usually, a default identity.

```yaml
# tasks/api.yaml (excerpt)
surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
      health:
        method: get
        access: { public: "Probes call it before any user exists." }
        output: Health
```

`prefix` is the surface's leading path. `{version}` is replaced by `api.version`. A prefix with no `{version}` gets `/v{version}` in front of it. A literal version segment such as `/v1` is then refused, with the mismatch stated when it differs from `api.version` (FR-2, SCN-032); the version is held once, on the api.

The path version is a default, not a rule (A33). `pathVersion: { omit: "<reason>" }` on the api, or on one surface, keeps it out: the prefix is used exactly as written, and may not hold `{version}`. That serves an api versioned by a header or a media type (declared with its own headers or formats) and a webhook path a third party fixes:

```yaml
# tasks/api.yaml (excerpt)
surfaces:
  stripeHooks:
    prefix: /stripe
    pathVersion: { omit: "Stripe calls the URL configured in its dashboard." }
    identity: stripe
```

Every node is a mapping of settings plus its children. There are four kinds of node:

| Node | Marked by | Children |
|---|---|---|
| route | `method` | none |
| relay route | `relays`, in a surface root's `routes` only (section 7) | none |
| collection | `kind: collection` | `ops`, `collection`, `member` |
| single | `kind: single` | `ops`, `routes` |

A surface root, a single, and the `collection` and `member` scopes of a collection hold their children under `routes`, a mapping from child name to node. The child name is written in the parent file even when its content is included (`search: { $include: ./routes/tasks/search.yaml }`), so every route stays discoverable from its parent (brief 5.1).

A node's path segment is its name, converted by `conventions.pathCase` (`kebab`, the default, `camel` or `snake`). `path` replaces the segment: it is relative to the parent, has no leading slash, may be empty or hold several segments, and may hold `{param}` placeholders declared in `pathParams`.

#### Collections and singles

```yaml
# tasks/api.yaml (excerpt: a node under routes)
tasks:
  kind: collection
  id: { taskId: TaskId }
  item: Task
  concurrency: { version: body.expectedVersion, field: version }
  ops: [list, get]
  collection:
    routes:
      search: { $include: ./routes/tasks/search.yaml }
  member:
    scopes: { task: path.taskId }
    routes:
      assign: { method: post, input: AssignTask, output: Task }
```

| Key | On | Meaning |
|---|---|---|
| `id` | collection | a fields map with one entry: the member id path parameter and its schema |
| `idProperty` | collection | the item property that holds the member id, when its name differs from the path parameter (`id` for `taskId`); default the parameter's name |
| `singular` | collection | the noun of member operation ids, instead of the one derived from `id` (below) |
| `resourceType` | collection, single | the value of the `$collection` slot (a JSON:API `type`, a HAL `_embedded` key), when it differs from the node name: `blog-posts` |
| `item` | collection, single | the schema of one record; a collection without `ops` that need it may omit it, and a single with neither `item` nor `ops` only groups its `routes` (`me` in the worked example) |
| `owner` | collection, single | `caller`: see write semantics |
| `concurrency` | collection, single | `{ version: <body or query source>, field: <item field> }`; on a member route, `concurrency: inherit` |
| `ops` | collection, single | the shorthand routes; see below |
| `collection` | collection | a node for the collection scope (`/tasks`): settings plus `routes` |
| `member` | collection | a node for the member scope (`/tasks/{taskId}`): settings plus `routes` |
| `routes` | single, surface, `collection`, `member` | the named children |

Settings written on the collection node apply to all its routes; settings written in `collection` or `member` apply to that scope only. The routes `list`, `create` and `batch` belong to the `collection` scope, and `get`, `update` and `delete` to the `member` scope: each inherits that scope's settings, and their origin is under `.../collection` or `.../member`. That is how a scope id read from the member path (`path.channelId`) applies to `getChannel` and every member route, and not to the list. A route's `path` is relative to its scope's path (`/tasks` for `collection`, `/tasks/{taskId}` for `member`).

A single with neither `item` nor `ops` is a group: settings and `routes`, nothing of its own. With a `path` of several segments, a group reaches a nested resource without the empty collections in between, each of which costs a `kind`, an `id`, a `member` and a `routes` level:

```yaml
# tasks/api.yaml (excerpt: under a surface's routes)
projectTasks:
  kind: single
  path: 'orgs/{orgId}/projects/{projectId}'
  pathParams: { orgId: OrgId, projectId: ProjectId }
  scopes: { org: path.orgId, project: path.projectId }
  routes:
    tasks: { $include: ./routes/tasks.yaml }
```

A group's path parameters are not member ids, so they derive no `notFound` (ADR 0006 section 5): a scope that reads them answers a missing one, as here, or a code attached on the group does. A route written directly in the group's `routes` takes the group's name in its operation id, while a collection below it names its own (`listTasks`). The two-collection form stays the one to use when the parents have operations of their own.

#### The `ops` shorthand

`ops` expands to ordinary routes; the IR holds only routes (brief 5.2). It is either a list of op names or a mapping from op name to settings for that op; the list `[get, update]` is the mapping `{ get: {}, update: {} }`.

| Op | On | Method and path | Operation id | Input | Success |
|---|---|---|---|---|---|
| `list` | collection | `GET /tasks` | `list` + plural (`listTasks`) | the paging style's request roles | `200`, a page of `item` (section 14) |
| `get` | collection, single | `GET /tasks/{taskId}`, `GET /me/preferences` | `get` + singular (`getTask`, `getPreferences`) | none | `200`, `item` |
| `create` | collection | `POST /tasks` | `create` + singular | required `input` | `201`, `item` |
| `update` | collection, single | `PATCH /tasks/{taskId}` | `update` + singular | required `input` | `200`, `item` |
| `delete` | collection, single | `DELETE /tasks/{taskId}` | `delete` + singular | none (a versioned delete reads its version from the query or a header) | `204`, or `200` with `output` (SCN-040) |
| `batch` | collection | `POST /tasks/batch` | `get` + plural + `Batch` (`getTasksBatch`) | `{ ids }`, at most `maxIds`, or a declared `input` | `200`, a table of `item` keyed by id |

The plural is the collection's name; the singular is the collection's `singular` when set, otherwise the id parameter's name without its trailing `Id` (`taskId` gives `task`), or the whole parameter name when it has no such suffix. `singular` keeps the id named like the item's property when the noun differs: `members` with `id: { userId: UserId }` and `singular: member` gives `listMembers` and `getMember`, and `userId` still matches `Member.userId` for the `$id` slots and the batch table. For a single, the noun is the single's name. The methods, paths, operation ids and statuses above are defaults (A36). An op mapping takes every route key of section 7 except `relays`, every inherited setting of section 8, and `maxIds` for `batch`, so any op may override its method, path, operation id, input, output and responses. `create` and `update` have no default input, because the item schema holds fields a client never sends; the missing input is a compile error naming the op. No other shorthand exists until a consumer needs one (lesson 5).

A `batch` op is a safe read sent as POST: the IR marks it safe, so CSRF, idempotency and cache derivations treat it as a read. Its `maxIds`, body limit and budget default to `conventions.batch` (FR-32, SCN-084).

Operation ids of other routes: a route under `member` is its name plus the singular (`assign` gives `assignTask`); under `collection`, its name plus the plural (`search` gives `searchTasks`); under a single, its name plus the single's name; under a surface root, its name. `operationId` replaces the derived id. Operation ids are unique across the api; a clash is a compile error naming both routes. Names are stored as word segments (ADR 0007). A derived id reads as a verb and a noun when the route name is a verb (`assign`, `search`, `archive`); a noun route gives an awkward one (`activity` under a workspace member gives `activityWorkspace`, a hook named `github` gives `github`), so name routes with verbs, or set `operationId`.

#### Write semantics

Kept from Arthome (brief 5.2, FR-2):

- `owner: caller`: the caller owns the records. On a collection, another caller's id answers 404 (derived), with no version and no 409; on a single, nothing is derived (SCN-004). The boundary cannot know who owns a record, so the handler (or the optional record loader of ADR 0012) answers it through its typed error result for the `notFound` role (ADR 0012), no hook is added, and the generated test helper checks the declared 404.
- Otherwise a write may be versioned: `concurrency: { version: body.expectedVersion, field: version }`. `version` is where the client sends the version it read: a body field, a query parameter, or a request header (`header.If-Match` reads it as a strong entity tag, `"7"`); `field` is the item property it is compared with. `update` and `delete` inherit it; a member route only with `concurrency: inherit` (SCN-003, SCN-031). The compiler adds the version parameter itself, typed like `field`, after the authored fields: to the body input for a body source, to the query or headers otherwise. No input restates it, and an input that declares it is a compile error ("remove it; `concurrency` adds it"); an item schema without `field` is a compile error naming the field. A route without a body never carries the version in one (A33): on a `delete` without `input`, a body source becomes the query parameter of the same name (`body.expectedVersion` gives `query.expectedVersion` on `deleteTask`), and a query or header source stays as it is. A stale write derives `409` from the `stateConflict` role for a body or query version. With `header.If-Match`, HTTP's own answers apply (RFC 9110, RFC 6585): a stale tag derives `412` from the `preconditionFailed` role, and a write without the header `428` from the `preconditionRequired` role; every response carrying the item writes its `ETag` from `field`, and `cache.etag` on such a route uses that tag. Each role stays renamable (section 11).
- DELETE when the record disappears; an action (`POST .../archive`) when it stays with a new state.

### 7. Routes

```yaml
# tasks/api.yaml (excerpt: a member route)
assign:
  method: post
  summary: Assign the task to a member of the channel.
  requires:
    - { right: roles, params: { allowed: [owner, editor] } }
  input:
    type: object
    required: [userId]
    properties: { userId: UserId }
  output: Task
```

| Key | Meaning |
|---|---|
| `method` | `get`, `post`, `put`, `patch` or `delete` |
| `path`, `pathParams` | the segment and the schemas of its extra placeholders (all required) |
| `operationId` | replaces the derived id |
| `query` | a fields map, or a schema name; an object-typed field and a list are encoded as `conventions.query` says, and any undeclared key is refused (FR-30). Written on a node, it reaches the safe routes below it only (section 8) |
| `headers` | request headers: a fields map keyed by header name |
| `input` | the body schema (`application/json`) |
| `output` | the body of the single success response, always the whole payload: its status is the op's default, or `200` |
| `item` | instead of `output`, on a route that is a list: the schema of one record (section 10) |
| `responses` | several responses keyed by status, instead of `output` |
| `paging`, `sortable`, `filteredBy` | list behaviour (section 10) |
| `degradable` | optional success-data paths that may be missing (FR-32) |
| `relays` | `<api>.<operationId>`: marks a relay route, whose shape is derived from that public operation (below, FR-8) |
| `examples` | named examples (section 12) |
| `summary`, `description` | docs |

Query wire kinds (number, boolean, list, text, object) derive from each field's schema type and need no keyword (FR-30, SCN-081). How a list and an object travel is a convention with a default (A36): `conventions.query.lists` is `repeat` (`tag=a&tag=b`, the default) or `comma` (`tag=a,b`), and `conventions.query.objects` is `explode` (an object's members as top-level keys, the default) or `deepObject` (`filter[state]=open`).

`responses` maps a status to `{ body, headers, description }`; `headers` is a fields map of response headers keyed by name. It serves several 2xx on one route (SCN-038), a `202` with `Location` and `Retry-After` (SCN-039) and a `DELETE` answering 200 with a body (SCN-040). Only success responses are written here; error responses come from error codes (section 11).

```yaml
# tasks/api.yaml (excerpt: a member route)
export:
  method: post
  responses:
    202:
      headers: { Location: Url, Retry-After: RetryAfterSeconds }
```

#### Relays

A service api (section 5) often serves operations of a public api: the public handler, or a gateway in front of it, forwards the call to a service route. `relays` pairs the two at compile time and derives the service route's shape from the public operation, so no fact is written twice (FR-8):

```yaml
# tasks-service/api.yaml (excerpt)
surfaces:
  internal:
    prefix: /internal/v{version}
    requires: [{ right: callerService, params: { allowed: [catalog] } }]
    routes:
      getTask: { relays: tasks.getTask }
      getTasksBatch: { relays: tasks.getTasksBatch, budget: 100ms }
```

A relay route is marked by `relays: <api>.<operationId>`, naming an operation of a sibling api of the workspace or of an api in `workspace.imports` (section 1). It sits in a surface root's `routes`, and its name is the public operation id, which is also its own; a different name is a compile error naming both, unless the route sets `operationId`. That is how a service api relays two operations of the same id, one from a sibling api and one from an import: `getBillingTask: { relays: billing.getTask, operationId: getBillingTask }`. The link step pairs the two operations by `relays`, whatever the id. The public operation's shape is copied, each copied element carrying `derivedFrom` with the derivation `relay.route` and the public operation's origin:

- the method, and the path after the public surface's prefix, appended to this surface's prefix (`/internal/v1/channels/{channelId}/tasks/{taskId}`), with the schemas of its path parameters;
- the query parameters, the declared request headers, the body input (with its `unknownKeys`), the success responses with their shapes and headers, the paging style and limits of a list, its sort keys without their rights, `concurrency`, and the wire format;
- the codes the public operation answers from its domain rather than from its access: those attached through `errors` on its nodes or by a pack entry, and its `notFound` code (`member.notFound`, `owner.caller`), each with its declaration.

The schemas, enums, scalars, formats, paging styles and error declarations the copies use join this api's IR. A name this api already declares must be the same declaration (a shared file, section 2); a different one is a compile error naming both.

Nothing about access is copied. The public operation's identity, CSRF, idempotency key, scopes, requirements, principal requirements, bindings, field rights, sort-key rights, cache and deprecation belong to the gateway, which checks them before it forwards. The relay route derives no field rights from the copied schemas either (ADR 0003 section 6): the service sends every field, and the public operation projects its output and checks its input for its own caller, so the service never asks a decider about a member's right for a service principal. The relay route runs under the service api's caller identity, inherits its surface's settings like any route, and writes only its `operationId` and the service's own settings: `requires`, `errors`, `errorRoles`, `budget`, `bodyLimit`, `idempotency`, `upstream`, `maturity`, `deprecated`, `tags`, docs and extension keys. Any other shape key on it (`method`, `path`, `pathParams`, `query`, `headers`, `input`, `output`, `item`, `responses`, `paging`, `sortable`, `filteredBy`, `concurrency`) is a compile error naming the public operation it is derived from.

The relay route derives its boundary errors from the copied shape under its own role bindings, like any route: `input.invalid`, `union.headerTag`, `body.limit`, `body.media`, `concurrency.version`, `paging.params`, `paging.gone`. The link step then checks the superset (ADR 0006 section 3): every code of the public operation that is not the gateway's own is a code of the relay route. The gateway's own are the codes of the access and api-wide derivations of ADR 0006 section 5: `identity.authenticate`, `signed.identity`, `csrf.cookieWrite`, `idempotency.write`, `principal.requires`, `binding.mismatch`, `requirement.errors`, `scope.errors`, `fieldRight.restricted`, `sortKey.restricted`, `rule.bucket`, `identity.deadline`, `identity.versionToken`, `api.gateway`, `api.service`, `response.undeclared` and `conventions.every`. Since the domain codes are copied, the check fails only when the two apis bind a boundary role to different codes (the public api answers `request.invalid` for `schemaInvalid`, the service api the default `api.schema_invalid`); the diagnostic names both operations, the missing code and the fix: bind the role to the same code, for the api or with `errorRoles` on the relay route (SCN-014).

`relays` has no run-time part. No target generates a forwarder: the service api's server targets generate the relay route like any route, and the public handler forwards with the service api's generated client when the app generates one (ADR 0011), or with its own code. `api.role: gateway` on the public api (section 5) is independent of it: it derives the 502, 503 and 504 a forwarding api may answer.

### 8. Inherited settings

Every node may set the settings below; its descendants inherit them, and the IR records the node each one came from (FR-2, SCN-003, SCN-035). No other state is global.

| Setting | Merge rule down the tree |
|---|---|
| `identity`, `access` | the nearest wins for each; a node setting `identity` without `access` makes the identity required below it (section 9) |
| `requires` | appended: requirements derived by pack entries first (packs in application order, entries in written order), then the ancestors' from the root down, then the node's own; the same right or rule twice with equal params is an error, except that a derived requirement equal to a written one is dropped and the written one stays |
| `scopes` | added; entering a scope twice is an error |
| `principal.requires` | union |
| `bindings` | added; one key bound to two different values is an error |
| `errors` | union, each attachment within its `reach` and `for` (section 11); a code declared on a node joins the api registry; an example narrowed by the nearest node wins |
| `errorRoles` | per role, the nearest wins, over `conventions.errors.derived` |
| `tags` | union |
| `headers`, `query` | added; one name declared twice is an error. `query` reaches safe routes only: a write route below a node's `query` does not get it |
| `upstream`, `maturity`, `internal`, `deprecated`, `budget`, `bodyLimit`, `cache`, `csrf`, `idempotency`, `format`, extension keys | the nearest wins |

`owner`, `concurrency`, `ops`, `id`, `singular`, `item`, `path`, `pathParams`, `paging`, `sortable`, `filteredBy`, `degradable`, `relays`, `examples`, `lint` and docs are not inherited: each applies to the node or element it is written on. Three inherited settings have limits: `deprecated.successor` is written on a route only, since one successor cannot serve several operations; `cache` applies to the GET routes below it and is refused on a non-GET route; a stated `maturity`, written on the route or inherited, wins over the one derived from `upstream`. An inherited requirement cannot be removed below; a route that needs fewer requirements belongs elsewhere in the tree. This keeps every requirement of a route visible in its ancestry. Requirements stack, they are not refined: `{ right: projectAccess, params: { level: read } }` on a `member` scope plus `{ right: projectAccess, params: { level: admin } }` on one of its routes asks the decide hook twice, in that order, and the route runs only when both allow. Where the second call matters, write the requirement on each route rather than on the scope; a `requirements` entry (section 9) keeps that to one name per route.

Inheritance by position has one trap. When the last key of a block is written one level too far left, the file is still valid YAML and the key becomes a setting of the enclosing node, reaching every route below it; a dedent in the middle of a block is a parse error, so only a last key is at risk. For an exception, that silently widens it from one route to a subtree while its reason stays present. The lint rule `seampact/subtree-exception`, a warning that `compile --strict` fails, therefore reports every `access.public`, `access.optionalAuth`, `csrf.exempt` and `idempotency.exempt` written on a node that is neither a route nor a surface root, naming the routes it reaches. An exception meant for a subtree keeps it with `lint.allow` and a reason (section 12). A code attached one level too high is not an exception: it shows in `seampact explain` (section 16) and in the diff of the committed OpenAPI document, where each response lists its codes with the node that attached them (ADR 0004 section 12).

### 9. Access, identities, rights, rules, scopes

#### Access on a node

- `identity: <name>`: the route requires that identity. A surface usually sets it once.
- `access: { public: "<reason>" }`: no authentication; the principal is null.
- `access: { optionalAuth: "<reason>" }`: an anonymous caller or the nearest `identity`. A presented credential that the authenticate hook refuses is treated as anonymous, never answered 401 (brief section 7, A33), which is what a sign-out with an expired session needs.
- `csrf: { exempt: "<reason>" }`: no CSRF check on this route's cookie writes.

`identity` and `access` are inherited separately, the nearest winning for each (section 8). A node that sets `identity` without `access` makes the identity required again below it; `optionalAuth` uses the nearest `identity`, and both may be set on one node. A route that resolves to neither an identity nor a public access is a compile error that names both fixes (FR-4, SCN-007). A public child under an identified parent still needs its reason (SCN-035).

#### Security schemes

```yaml
# shared/base.yaml (excerpt)
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  deviceToken: { kind: header, name: X-Device-Token }
  internalToken: { kind: bearer, bearerFormat: jwt }
```

`kind` is `cookie`, `header` (an API key in a header), `bearer` (HTTP bearer) or `signature` (A5). `name` is the cookie or header name. `bearerFormat` documents a bearer token's format, emitted as OpenAPI's `bearerFormat`; nothing checks it. `csrf` on a cookie scheme names the header scheme a cookie write must also present; CSRF is derived from it, never written on an identity (FR-27, SCN-008, SCN-077). CSRF is opt-in (A34): a cookie scheme without `csrf` derives no CSRF check, and the lint rule `seampact/cookie-without-csrf` reports it, silenced with a reason through `lint.allow`. A `signature` scheme declares (details and test vectors: ADR 0013):

```yaml
# shared/base.yaml (excerpt)
schemes:
  stripeSignature:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }
```

`name` is the header carrying the signature, as for a header scheme. `format` holds `{sig}` and optionally `{ts}`; `payload` holds `{rawBody}` and optionally `{ts}`. `tolerance` is required when `{ts}` is used and refused otherwise. `key` is the one way to name the key identifier the application's secret lookup receives (FR-20): `{ value: <literal> }`, or `{ from: <path, query or header source> }`. A `from` source is read per route: every route under an identity whose scheme reads `key.from` must have that parameter (a path placeholder, a declared query field or request header), and a route without it is a compile error naming the route, the identity and the source.

```yaml
# shared/base.yaml (excerpt): one secret per workspace, GitHub style
schemes:
  githubSignature:
    kind: signature
    name: X-Hub-Signature-256
    format: 'sha256={sig}'
    algorithm: hmac-sha256
    payload: '{rawBody}'
    encoding: hex
    key: { from: path.workspaceId }
identities:
  github:
    kind: signed
    scheme: githubSignature
    principal: WebhookCaller
    unknownKeys: { ignore: "GitHub adds payload fields without notice." }
```

#### Identities

```yaml
# shared/base.yaml (excerpt)
identities:
  viewer:
    schemes:
      read: [sessionCookie, bearer]
      write: [sessionCookie, bearer]
      optionalRead: [deviceToken]
    principal: ViewerPrincipal
  viewer_or_device:
    schemes: { read: [sessionCookie, bearer], write: [sessionCookie, bearer], optionalRead: [deviceToken] }
    principal:
      variants: { viewer: ViewerPrincipal, device: DevicePrincipal }
  stripe:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller
```

| Key | Meaning |
|---|---|
| `kind` | `credential` (default) or `signed` |
| `schemes.read`, `schemes.write` | the schemes accepted on reads and on writes, both required, so adding a read scheme never widens writes; `write: []` refuses the identity on writes |
| `schemes.optionalRead` | extra schemes accepted on optional-auth reads only (FR-27, SCN-076) |
| `scheme` | `signed` only: the one `signature` scheme; the compiler forces a raw body and removes CSRF and idempotency keys (FR-20, SCN-026) |
| `principal` | the principal schema, or `{ variants: { <name>: <schema> } }` for an identity accepting several credential kinds; hooks and handlers narrow on the variant name |
| `unknownKeys` | `signed` only: `{ ignore: "<reason>" }`; the body input of every route of the identity drops unknown keys instead of refusing them (ADR 0003 section 4), for a sender whose payloads grow without notice |
| `errors` | codes attached to every route of the identity, as a list of codes |
| `headers` | the identity headers it uses, below |

Identity headers (FR-28) are declared in the `headers` catalogue, so a pack can supply their names without the identity that uses them (SCN-079), and each identity names the ones it uses with the facts of that use:

```yaml
# packs/house.yaml (excerpt)
headers:
  deadline: { name: X-Deadline, in: request, semantic: deadline }
  trace: { name: traceparent, in: request, semantic: traceContext }
  actorSurface: { name: X-Actor-Surface, in: request, semantic: actorSurface }
  rightsVersion: { semantic: versionToken, response: X-Rights-Version, request: If-Rights-Version }
```

```yaml
# studio/base.yaml (excerpt)
identities:
  operator:
    schemes: { read: [sessionCookie], write: [sessionCookie] }
    principal: OperatorPrincipal
    headers:
      rightsVersion: { from: principal.rightsVersion, for: writes, required: false, stale: api.rights_version_stale }
```

A header declaration takes `name`, `in` (`request` or `response`), `semantic` and optionally `schema`. `semantic` lets targets generate behaviour: `deadline` (an instant; the client computes it from the budget, the server exposes the remaining time and answers 504 from the `deadlineExceeded` role once it has passed), `traceContext` (relayed, never refused when malformed), `actorSurface` (a strict enum, named by `schema`), `versionToken`. A `versionToken` declares `response` and `request` names instead of `name` and `in`, because one fact drives two headers: the response header on every success and an optional request header compared on use.

A use takes `for` (`all`, `reads` or `writes`; for a `versionToken`, the request header's), `required` (default `false`), `schema` when the declaration has none (setting it in both places is an error), and for a `versionToken` `from` (the principal field) and `stale` (the code answered to a stale request header). The header names are the contract's or a pack's, never the core's (SCN-079).

#### Principal requirements and bindings

```yaml
# tasks/api.yaml (excerpt: route settings)
principal: { requires: [profileId] }
bindings: { body.profileId: principal.profileId, path.profileId: principal.profileId }
```

`principal.requires` lists principal fields that must be present; a principal without one answers 403 after authentication, and the handler receives the field as non-optional (SCN-034). `bindings` maps a request value to a principal field; a mismatch answers 403 before the handler (SCN-010). Both answers use the `forbidden` role (section 11).

#### Requirements

`requires` is an ordered list. Each item names either a right or a rule (FR-5):

```yaml
# tasks/api.yaml (excerpt: route settings)
requires:
  - { rule: throttle, bucket: write }
  - { right: roles, params: { allowed: [owner, editor] } }
  - { right: tasks.update }
  - { right: tasks.update, subject: path.taskId }
```

| Key | Meaning |
|---|---|
| `right` or `rule` | the catalogue name |
| `params` | the values of the right's or rule's typed params |
| `subject` | rights only: a value source; see below |
| `bucket` | rules declared with `bucket: true` only: a bucket name |

A requirement written on several routes is named once in the `requirements` catalogue and used by its name, a plain string in `requires`:

```yaml
# tasks/api.yaml (excerpt)
requirements:
  channelEditor: { right: roles, params: { allowed: [owner, editor] } }
  writeThrottle: { rule: throttle, bucket: write }
```

```yaml
# tasks/api.yaml (excerpt: route settings)
requires: [writeThrottle, channelEditor, { right: tasks.update }]
```

An entry holds one requirement item, with the keys above. In `requires`, a plain string always names an entry and a mapping is always an item, so an entry never hides a right of the same name. The IR holds the expanded item, with `entry` naming the catalogue entry it was written through (ADR 0004), and every rule of this section applies to it as if it were written at the use.

The check order is fixed (FR-5, ADR 0012): transport refusals, authentication, principal requirements, scopes in nesting order, requirements in the order of this list, input validation, restricted input fields and sort keys, bindings, the handler. A requirement may sit on a public or optional-auth route; its hook then receives a null principal for an anonymous caller (SCN-036). A rule may always; a right only when it is guest-enabled (below).

#### Rights

```yaml
# shared/base.yaml (excerpt)
rights:
  roles:
    params: { allowed: { type: array, items: { enum: Role }, minItems: 1 } }
    subject: { scope: channel }
  tasks.update:
    subject: { resource: Task, id: TaskId }
    errors: [api.forbidden, api.not_found]
  articles.read:
    subject: { resource: Article, id: ArticleId }
    guest: "Published articles are readable without an account."
```

| Key | Meaning |
|---|---|
| `params` | a fields map or a schema name; typed in the decide request |
| `subject` | absent (none), `{ scope: <scope> }`, or `{ resource: <Name>, id: <id schema> }` |
| `guest` | a reason; required for the right to appear on a public or optional-auth route, where an anonymous caller reaches it (SCN-063) |
| `errors` | the denial codes the decide hook may answer; default the code of the `forbidden` role |
| `summary`, `description`, extension keys | docs and consumer metadata that reach the generated boundary (A20, SCN-064) |

At the use site, a resource subject defaults to the nearest member id whose schema is the right's `id` schema (`path.taskId` for `tasks.update` under `tasks`); otherwise `subject` is required. The source's schema must equal the subject's id schema (SCN-062). A scope subject takes the route's resolved scope; a route without that scope is a compile error. Roles, permissions and custom questions are all rights (FR-22); naming conventions and derived rights come only from opt-in packs (FR-26, SCN-073).

#### Rules

```yaml
# shared/base.yaml (excerpt)
rules:
  throttle:
    bucket: true
    errors: [api.rate_limited]
  recentAuth:
    params: { intent: { enum: ReauthIntent } }
    proof: { in: body, name: reauthToken, schema: ReauthToken }
    errors: [api.reauthentication_required]
```

A rule is a pre-handler check that is not a right: no subject, no use on fields, sort keys or lists. `params` and `errors` are as for rights. `bucket: true` makes each use name a bucket, whose key sources and limits reach the decide hook; the 429 reply and its `Retry-After` come from the conventions (FR-41, SCN-096). `proof` declares a value the rule reads from the request (`in: body` or `in: header`): the compiler adds the field to the route's input once, after the authored fields, and marks it sensitive (SCN-097). A body proof is refused on a route without a body, which is a `get`, or a `delete` without `input`; on any other route without `input` (a POST action such as `revealStreamKey`), the proof becomes the whole input.

#### Buckets

```yaml
# shared/base.yaml (excerpt)
buckets:
  signInPerEmail: { key: [body.email, address], limit: 10, window: 15m }
  export: { key: [principal.accountId] }
```

`key` lists the sources counted; `limit` and `window` may be left for the server to bind, and the compiler then warns (SCN-096). A bucket key is checked at each use: a `body.<field>` key must name a string or integer field of the route's input, checked against that field's schema when the rule reads it (step 5 of the check order, as for a body proof); a missing field, and a `principal.<field>` key on a public or optional-auth route, where the principal may be null, are compile errors naming the bucket and the route.

#### Scopes

```yaml
# shared/base.yaml (excerpt)
scopes:
  org: { id: OrgId, errors: [api.not_found] }
  project: { id: ProjectId, within: org, errors: [api.not_found] }
  tenant: { id: TenantId, errors: [api.forbidden] }
```

A scope catalogue entry declares the id schema, an optional parent scope (`within`) and the membership denial codes. A node enters scopes with `scopes`, a mapping from scope name to a value source:

```yaml
# tasks/api.yaml (excerpt: node settings)
scopes: { org: subdomain, project: path.projectId }
```

`resolver` means the application implements the resolver (A23, SCN-070). Scopes resolve in nesting order: a scope entered at an ancestor before one entered below it; inside one node, a parent scope before its child, then by name. A scope entered below its own child scope is an error (FR-24, SCN-069).

### 10. Lists, cache and lifecycle settings

- A route is a list when it comes from the `list` op, or when it sets `item` instead of `output`. `output` always means the whole body; an array `output` on a GET is refused with the fix "use `item`", so an author always knows whether a route is paged.
- `paging`: on a list. It names a paging style from the `pagings` catalogue (section 14): `paging: cursor`, or the mapping form `{ cursor: { maxLimit: 50 } }`, which also takes `defaultLimit`, `overLimit` and, for a style with a `since` role, `token: opaque` or `token: instant`. A list without `paging` uses `conventions.paging.default`. A list with neither is a compile error naming both fixes: declare a style in `pagings` and name it, or apply a format pack that provides one (A31). `paging: { none: "<reason>" }` serves the whole list unpaged, through the format's `list` shape. A style with a `since` role derives 410 from the `gone` role (FR-31, SCN-012, SCN-082, SCN-083).
- `sortable`: a list of item fields, each a name or `{ key, right }`. A key inherits its field's `restrictedTo`; an explicit right that disagrees is a compile error; sorting by a restricted key without the right derives 403 from the `sortKeyForbidden` role (FR-23, SCN-067).
- `filteredBy: <right>`: the right the application applies to its query; it reaches OpenAPI and the handler context, and nothing enforces it (SCN-068).
- `degradable: [viewerProgress]`: paths of optional properties of the success data; a required one is a compile error (SCN-085).
- `cache: { freshness: minute, anonymous: public, vary: [Accept-Language], etag: true }`. `freshness` is a family from `conventions.cache.families` or `never` (no-store); `anonymous` (`public` or `private`) applies to anonymous callers only, since an identified caller always gets private; `etag: true` generates conditional GET (FR-33, SCN-013, SCN-086). The `Vary` entries for credentials (`Cookie`, `Authorization`, an API-key header) are derived from the schemes of the route's identity; `vary` lists only the other request headers the response depends on.
- `budget: 300ms`: the client's default timeout and the deadline sent on an identity with a `deadline` header (SCN-043, SCN-078).
- `bodyLimit: 2MiB`: overrides `conventions.bodyLimit` (SCN-041).
- `format: { use: bare, reason: "<reason>" }`: the wire format of the routes below, instead of `conventions.format`, for an endpoint whose body a third party fixes (a load balancer's health probe, a vendor's callback). It names any declared format and takes a reason, because it departs from the api's format.
- `idempotency: { exempt: "<reason>" }`: a write without the idempotency key (SCN-042). The generated clients send the key: a client target creates a fresh key per call (a UUID v4) unless the caller passes one, and returns it with the result. A client never replays a write by itself (FR-15); a caller that retries passes the key of the first attempt, so the write runs once.
- `internal: true`: keeps the route out of documents with `internal: exclude` (product apis only, SCN-044).
- `upstream: [streaming, catalog]`: services from the `services` catalogue, the owning service first. The operation's maturity derives from the owning service, otherwise from `api.maturity` (FR-34).
- `maturity: { level: experimental, reason: "<reason>" }`: a stated maturity. On a node it departs from the derived level, so it takes a reason; on the api, `maturity` is a bare level, the default every operation derives from. A stated level equal to the derived one is reported by the lint rule `seampact/redundant-maturity`, silenced through `lint.allow` (SCN-087, SCN-018).
- `deprecated: { sunset: '2027-06-30', successor: getTask }`: derives the deprecation, sunset and successor headers (FR-13, SCN-051); `successor` only on a route. Their names default to RFC 9745's `Deprecation`, RFC 8594's `Sunset` and a `Link` with relation `successor-version`, and `conventions.deprecation` renames them (A36).
- `tags: [tasks]`.

```yaml
# shared/base.yaml (excerpt)
services:
  catalog: { maturity: stable }
  streaming: { maturity: provisional }
```

### 11. Errors and natures

```yaml
# shared/base.yaml (excerpt)
errors:
  api.forbidden:
    status: 403
    nature: refused
    title: The caller may not do this.
    params: { pointer?: { type: string } }
  api.rate_limited:
    status: 429
    nature: unavailable
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }
```

A declaration defines a code once: `status` (400 to 599), `nature`, `family`, `params` (a fields map or a schema name), `example` (the params), `title`, `description` (FR-6, SCN-037). `nature` may be left out: it is then `unavailable` for 408, 425, 429, 502, 503 and 504, `refused` for every other 4xx and `failed` for every other 5xx. `family` groups codes in docs and clients; it defaults to the code up to its first dot (section 4).

Codes are declared at every level of the tree (A35): in the `errors` catalogue (the api's global level, with its base and packs), or in `errors` on any node: a surface root, a collection, a single, a `collection` or `member` scope node, or a route. On a node, `errors` maps a code to one of:

- `{}`: attaches a code declared elsewhere;
- `{ example }`: attaches it and narrows its example to this subtree's case;
- a declaration (it holds `status`): declares the code and attaches it.

Each of the three may add `reach` and `for`, below.

```yaml
# tasks/api.yaml (excerpt: node settings of tasks)
errors:
  state.conflict: {}
  tasks.not_found: { status: 404, title: 'No such task in this channel.' }
  api.rate_limited: { example: { retryAfterMs: 30000 } }
member:
  errorRoles:
    notFound: tasks.not_found
  errors:
    tasks.locked:
      status: 423
      title: 'Another editor holds the task.'
      params: { lockedBy: UserId }
      reach: resource
      for: writes
```

A node's codes attach to the operations below it; children add codes or narrow an example, never remove one (section 8). How far "below" goes is the attachment's reach. `subtree`, the default (A35), attaches the code to every operation below the node, child resources included. `resource` stops at the resource boundary: the code reaches the node's own `ops` and the routes of its `collection`, `member` and `routes` maps, but no child node with `kind` (a nested collection or single) and nothing below one. `conventions.errors.reach` sets the api's default; `reach` on one attachment overrides it. `for` narrows an attachment to `reads` (the safe routes, a `batch` read included) or `writes` (every other route); `all` is the default, as for an identity header's `for` (section 9). Above, `tasks.locked`, attached on `member` for writes with `reach: resource`, reaches `updateTask` and `assignTask` but not `getTask`, nor the routes of a `comments` collection nested under a task, so each error union lists only what its route can answer. `conventions.errors.every` attaches codes to every operation. Codes are api-wide, whatever level declares them: a code declared on a node joins the api's registry and any other node may attach it by name. Declaring a code a second time with a different definition is a compile error naming both locations; re-attaching it, here or below, is how it is reused. Rights, rules, scopes and identities list the codes they may answer, attached with `derivedFrom` in the IR. The IR records, for each operation's code, the node it was attached at, and for each declaration where it was declared (ADR 0004).

A nature tells a client whether retrying can help. Three base natures drive every client's retry rule: `refused` (retrying the same request cannot succeed), `unavailable` (retrying later may succeed) and `failed` (the server failed). A contract or a pack may name its own natures in the `natures` catalogue, each mapped onto one base (A40):

```yaml
# shared/base.yaml (excerpt)
natures:
  throttled: { base: unavailable, summary: 'Too many requests; retry after the stated delay.' }
  conflict: { base: refused }
```

An error then states `nature: throttled`. The `$nature` slot writes the declared name, and a client takes its retry rule from the base of the code's declaration, which the generated client holds from the IR, never from the wire; every client therefore keeps one retry rule however many natures a contract names. A nature named like a base, or mapped onto anything but a base, is a compile error naming the allowed values (SCN-037).

#### Error roles

Derived errors answer roles, never fixed codes: `unauthenticated` (401), `csrfInvalid`, `forbidden`, `sortKeyForbidden` (403), `notFound` (404), `schemaInvalid` (400), `payloadTooLarge` (413), `unsupportedMediaType` (415), `stateConflict`, `idempotencyInProgress` (409), `gone` (410), `preconditionFailed` (412), `idempotencyKeyReused` (422), `preconditionRequired` (428), `rateLimited` (429), `undeclaredStatus` (500), `upstreamUnavailable` (502), `serviceUnavailable` (503), `upstreamTimeout`, `deadlineExceeded` (504). The derivation table that uses them is ADR 0006 section 5.

Every role has a default code in the core (`api.schema_invalid`, `api.forbidden` and the others of ADR 0006 section 6), registered when used and rendered through the api's format, so a contract with no pack compiles (A34). A role is renamed for the whole api by `conventions.errors.derived`, or for a subtree by `errorRoles` on any node, the nearest binding winning (A35). Above, every member route of `tasks` answers `tasks.not_found` for the `notFound` role: a route below a collection's `member` scope derives it for an id the client chose and no scope reads (ADR 0006 section 5), and the handler answers it, as any code its operation lists, through a typed error result (ADR 0012). The binding sits on `member`, not on the collection node: `listTasks` and `createTask` hold only parent ids in their path, and a binding there would rename the 404 of a missing parent too. A binding is a code, or `{ code, params }`:

```yaml
# shared/base.yaml (excerpt)
conventions:
  errors:
    derived:
      schemaInvalid:
        code: api.schema_invalid
        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }
      forbidden: { code: api.forbidden, params: { pointer: $pointer } }
```

The boundary produces data for each role (the validation issues, the restricted field's pointer, the sort key, the body limit, the retry delay; ADR 0006 section 6 lists them). Without `params`, each param of the bound code takes the datum of the same name. `params` is a template (section 13) over the role's data. A bound code must be registered, and its params must receive every datum the role marks required, by name or through `params`; otherwise the binding is a compile error naming the role, the datum and the code.

### 12. Enums, examples, docs, extensions, lint

```yaml
# shared/base.yaml (excerpt)
enums:
  Role: { values: [owner, editor, viewer], reason: "Roles are local to this product." }
  PublicationState: { values: [draft, published, withdrawn], source: { vocabulary: domain.publication } }
  ErrorNature: { values: [refused, unavailable, failed], fallback: unavailable, reason: "Mirrors the core natures." }
  Answer: { values: ['yes', 'no'], reason: "A survey answer." }
```

An enum declares `values` (strings, unique) and either `source` or, for a local enum, `reason` (FR-29). `conventions.enums.reason` gives the reason of every local enum that states none, so an api whose enums are all its own product rules says so once. `source: { vocabulary: <name> }` names an external vocabulary: the name is a free label for the reader, with no declaration and no pattern. `source: { enum: <Enum> }` takes another enum's values as its own, so `values` is omitted; a subset at one use is a narrowing (ADR 0003 section 7), not a new enum. `fallback` names the member a client decoder maps an unknown value to (SCN-080). Narrowing happens at a use, inside a schema (ADR 0003). Members such as `yes` and `no` must be quoted (section 3).

Examples are named, on a route, and parsed against their schema at compile time (FR-3, SCN-006):

```yaml
# tasks/api.yaml (excerpt: route settings)
examples:
  firstPage: { status: 200, value: { $file: ./examples/search-200.json } }
  minimal: { request: true, value: { title: 'Write the brief' } }
  emptyTitle: { error: api.schema_invalid, value: { issues: [{ pointer: /title, rule: minLength }] } }
```

An example targets a success status, the request (`request: true`), or one of the operation's error codes (`error: <code>`). An error example's `value` is the code's params, parsed against its params schema; a code the operation does not list is a compile error naming it, and the emitter writes the params inside the format's error body, under the code's status. It shows the case of this route (here, an empty title), while the registry's `example` stays the code's default (section 11). Schema examples are ADR 0003. A success example's `value` is what the handler returns: the payload for an item, the item array for a list (paged or not), the id-keyed object for a table. It is parsed against that schema, and the OpenAPI emitter wraps it through the operation's format and paging style before writing it, so an example never restates an envelope (A30).

Docs are `summary` (inline) and `description` (inline or `$file`) on apis, nodes, routes, errors, rights, rules, scopes, identities and enums; schemas use JSON Schema's `title` and `description` (FR-34, SCN-088).

Consumer extension keys (FR-10, SCN-016) are declared with a JSON Schema under a prefix:

```yaml
# shared/base.yaml (excerpt)
enums:
  TaxBasis: { values: [inclusive, exclusive], reason: "Acme's tax rules." }
extensions:
  acme:
    tax-basis:
      at: [operation, property]
      schema: { enum: TaxBasis }
    invalidates: { at: [operation], schema: { type: array, items: { type: string } } }
```

An extension's `schema` is written in the subset of ADR 0003, like any schema. `at` lists where the key may appear: `api`, `operation` (any tree node, inherited), `schema`, `property`, `right`, `rule`, `scope`. The key is written `x-<prefix>-<key>` at its place of use (`x-acme-tax-basis: inclusive`). A core keyword never starts with `x-`, so an extension never collides with one, and no domain key becomes a core keyword (SM-6). The compiler validates every value with a located diagnostic.

`lint: { allow: { <rule id>: "<reason>" } }` on any node, schema or property silences one lint rule there (FR-12, SCN-018).

### 13. Conventions and wire formats

`conventions` holds the api-wide settings. Any layer may set them (section 2), usually a pack; a node never does, because a convention is one fact for the whole api. The table gives each key's default and, where there is none, when the key becomes required; a missing required key is a compile error naming the key, the route that needs it and the fix.

```yaml
# shared/base.yaml (excerpt)
conventions:
  format: bare
  pathCase: kebab
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h, methods: [post] }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB, budget: 150ms }
  cache: { families: { minute: 60s, five_minutes: 300s } }
  restrictedInput: reject
  outputEnums: enum
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
  errors:
    every: [api.internal]
    derived: { unauthenticated: api.unauthenticated, forbidden: api.forbidden }
```

| Key | Meaning | Default, or when required |
|---|---|---|
| `format` | the wire format (section 13) | `bare` (A30) |
| `pathCase` | how node names become path segments: `kebab`, `camel` or `snake` | `kebab` |
| `paging.default` | the paging style of a list without `paging` (section 14) | none: a list with neither is a compile error naming both fixes (A31) |
| `paging.maxLimit` | the largest `limit` a request may send | none: required when a list uses a style with a `limit` role and sets no `maxLimit` |
| `paging.defaultLimit` | the limit of a request that sends none, and the page size of a style without `limit` | `maxLimit`; required for a style without `limit` |
| `paging.overLimit` | `reject` (400) or `clamp` (served as `maxLimit`): a `limit` above `maxLimit` (section 14) | `reject` |
| `idempotency` | `{ header, replayHeader, lifetime, methods, required }`: enables the idempotency key on every non-safe route whose method `methods` lists and that is not exempt (FR-7, A34). `methods` lists `post`, `put`, `patch` and `delete`, all four by default, so a POST-only policy is `methods: [post]`. `required` is `true` by default: a request without the key answers 400 from the `schemaInvalid` role; with `false` it runs without replay protection | unset: no key is derived, and an `idempotency.exempt` on a route the key does not reach is a compile error naming the unused reason |
| `bodyLimit` | the default request body limit | `1MiB` |
| `batch` | `{ maxIds, bodyLimit, budget }` for `batch` ops | `maxIds` required when a `batch` op sets none; `bodyLimit` from `bodyLimit`; no budget |
| `cache.families` | freshness families and their max-age | empty: each family a `cache.freshness` names is required |
| `restrictedInput` | `reject` or `strip`: a restricted field sent without its right (A21); overridable per field (ADR 0003) | `reject` |
| `outputEnums` | `enum` or `open`: how the emitter writes an output enum (FR-29) | `enum` |
| `enums.reason` | the reason of every local enum without its own (section 12) | unset: each local enum states its reason |
| `query` | `{ lists, objects }`: how a query list and an object field travel (section 7) | `{ lists: repeat, objects: explode }` |
| `int64` | `string` or `number`: the wire form of an `int64` value (ADR 0003 section 8) | `string` |
| `deprecation` | `{ header, sunsetHeader, successorRel }`: the names of the deprecation headers (section 10) | `Deprecation`, `Sunset`, `successor-version` |
| `rateLimit` | `{ header, param, unit }`: the header written on a 429 from a bucket rule, carrying the denial's integer millisecond `param` in `unit` (`s`, rounded up, or `ms`) | unset: a 429 carries no retry header |
| `degradedHeader` | the header listing degraded parts | unset: required for a `degradable` route whose format has no `degraded` meta field |
| `urls` | `relative` or `absolute`: how the URL slots and roles are written (section 13) | `relative` |
| `rights.pattern` | a pattern every right name must also match (section 2) | unset: the core pattern only (A20) |
| `errors.pattern` | a pattern every error code must also match, the dotted `family.name` form for example (`'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'`) | unset: the core pattern only (A36) |
| `errors.every` | codes attached to every operation (section 11) | empty |
| `errors.reach` | `subtree` or `resource`: how far a code attached on a node reaches (section 11) | `subtree` (A35) |
| `errors.derived` | role bindings (section 11) | the default codes of ADR 0006 section 6 (A34) |

The core imposes no wire format (A30). `format: bare`, the default, is itself written as format data below: every success body is the bare payload, and an error is an RFC 9457 `application/problem+json` body whose members are fixed in ADR 0006 section 7. `bare` has no paging style, because the core imposes no page shape either (A31, section 14). Every other format (an envelope like Arthome's, JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring Page and ProblemDetail) is declared in `formats`, usually by a convention pack, and selected with `conventions.format`; each target maps it onto its framework's own mechanism (FR-42, SCN-048, SCN-100).

#### Wire formats

```yaml
# packs/house.yaml (excerpt)
formats:
  acmeEnvelope:
    media: application/json
    success:
      item: { body: { data: $payload, meta: $meta } }
      table: { body: { data: $payload, meta: $meta } }
      list: { body: { data: $payload, meta: $meta } }
      page: { body: { data: $items, meta: $meta } }
    meta:
      servedAt: { fill: now }
      degraded: { fill: degraded }
    error:
      body: { error: { code: $code, nature: $nature, params: $params, traceId: $traceId } }
```

| Key | Meaning |
|---|---|
| `media` | the media type of success bodies; `application/json` by default |
| `absent` | what a slot with no value writes: `omit` (default) or `null` |
| `success.item`, `success.table`, `success.list`, `success.page` | one per response shape: `{ body, headers }`. `body` is a template, `$payload` by default (`$items` for `page`); `headers` maps a header name to a template. `item` is one record or any non-list body, `table` the id-keyed object of a `batch` read, `list` an unpaged list, `page` a paged list, whose paging style adds members to it or replaces its body (section 14) |
| `meta` | the meta fields, each `{ fill, schema }`: `fill` is `now`, `traceId`, `degraded`, a `principal.<field>` source, or `handler` (which then needs `schema`) |
| `error` | `{ media, body, headers }`; `media` defaults to the format's. A format without `error` uses the `bare` error. The body must write `$code`, as a member or inside a text template (`'https://errors.acme.com/${code}'`), so a client can tell the code; a format whose error writes no `$code` is a compile error naming the format |

A shape left out uses its default (`body: $payload`, or `$items` for a page, and no headers), so `bare` writes only its error.

#### Templates

A template describes a JSON value the boundary writes. The same language serves format shapes, paging styles (section 14) and error-role params (section 11).

| Written | Meaning |
|---|---|
| `$name` (the whole string) | a slot: the value the boundary fills, with its own JSON type |
| `$name.member` | a member of an object slot (`$item.taskId`, `$issue.pointer`) |
| `${name}` inside a longer string | the slot's value as text (`'/contexts/${resource}'`, `'${status}'`) |
| `$$` | a literal `$` (`$$ref` writes `$ref`) |
| a mapping | an object; each key is a member name, written literally |
| the key `$merge: <slot>` | spreads an object slot's members beside the others; a member defined twice is a compile error naming both |
| a key that is a name slot (`$collection`) | the member name is the slot's value |
| `{ $each: <slot>, $as: <template> }` | an array: `$as` applied to each element of an array slot; inside it, `$item` is the element |
| a sequence | an array of templates |
| any other scalar | a literal |

A member whose value is a slot with no value is omitted, or written `null` when `absent: null`; an object whose members are all omitted is omitted in turn, so `next: { href: $next }` disappears on the last page. `$merge` takes an object-typed slot only, and a payload that is not an object fails to compile under a format that merges it.

The slots are a closed set:

| Slot | Value | Where |
|---|---|---|
| `$payload` | what the handler returns: the item, the id-keyed table, or the array of an unpaged list | success shapes |
| `$meta` | the object of the format's `meta` fields; in `success.page`, joined by the `meta` members of the paging style (section 14) | success shapes, paging styles |
| `$items` | the page's records, as the handler returns them | `success.page`, paging styles |
| `$status` | the HTTP status | everywhere |
| `$self` | the URL of what the body describes: the member URL of a collection item (built from `$id`), the current page of a paged list, the request URL otherwise | everywhere |
| `$path` | the request path, without the query | everywhere |
| `$resource` | the item schema's `typeName` (ADR 0003 section 6), or its name (`Task`) | success shapes, paging styles |
| `$collection` | the collection's or single's `resourceType`, or its node name (`tasks`); also a member name | `table`, `list`, paging styles |
| `$id`, `$fields` | the record's id, and the record without its id member | `item` |
| `$item`, `$itemId`, `$itemFields`, `$itemSelf` | inside `$as`: the element, its id, the element without its id member, its member URL | `$as` |
| `$code`, `$nature`, `$title`, `$detail`, `$instance`, `$traceId`, `$params` | the error's code, nature, title (or code), optional text, optional occurrence reference, optional trace id, and its params object | `error` |
| `$<role>` | a paging response role (section 14) or an error-role datum (section 11) | paging styles, role params |

`$id`, `$fields`, `$itemId`, `$itemFields` and `$itemSelf` read the item property named by the collection's `idProperty`, or else named like its `id` parameter (`taskId`); a format that uses one on an operation whose item lacks that property fails to compile, naming the operation and the property. The batch table is keyed by the same property. The URL slots (`$self`, `$itemSelf` and the URL roles of section 14) are relative references by default; `conventions.urls: absolute` writes absolute URLs, built from the request's scheme and host as the framework's trusted-proxy settings report them, since the boundary cannot guess a public host behind a proxy. The names `bare` (format), `never` (cache family) and `none` (paging style) are reserved, and so are the portable format names in `scalars` (ADR 0003 section 8).

### 14. Paging styles

Paging imposes no convention (A31). A paging style lists the semantic roles a list uses and maps each one to a location and a name of the contract's choosing: a query parameter or a request header for the request roles, a body member, a response header or an RFC 8288 `Link` relation for the response roles. Styles live in the `pagings` catalogue; a format pack provides presets of them (section 15). Roles are core semantics: the core knows what each one means and who fills it, never what it is called.

```yaml
# shared/base.yaml (excerpt)
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
      links: { next: $next }
  changes:
    request:
      since: { query: since }
      limit: { query: limit }
    response:
      body: { items: $items, next: $nextSince, complete: $complete }
```

| Key | Meaning |
|---|---|
| `request` | request roles, each `{ query: <name> }` or `{ header: <name> }`; `page` also takes `base` (`1` by default, or `0`), `sort` takes `style` and, for `style: split`, `direction` |
| `response.meta` | members added to the format's page: each maps a member name to a template over the response roles, and joins the `$meta` slot of the format's `success.page` |
| `response.body` | instead of `meta`: the whole page body, replacing the format's `success.page` body; a template whose slots are the response roles and `$meta`, with `$items` exactly once |
| `response.headers` | response headers, each a template (`X-Total-Count: $total`) |
| `response.links` | RFC 8288 relations written in one `Link` header, each mapped to a URL role (`next: $next`) |
| `absent` | as on a format; `omit` by default |

A style without `body` keeps the format's page shape and adds to it, so the wrapper stays the format's and a style survives a change of format. Under `@seampact/pack-laravel`, whose page shape is `{ data: $items, meta: $meta }`:

```yaml
# shared/base.yaml (excerpt)
pagings:
  pages:
    request:
      page: { query: page }
      limit: { query: perPage }
    response:
      meta: { page: $page, lastPage: $totalPages, perPage: $limit, total: $total }
```

A page of `pages` is `{ data: [...], meta: { page, lastPage, perPage, total } }`, plus the format's own `meta` fields when it declares some (a `servedAt` filled with `now`); a member named by both the format and the style is a compile error naming both. A style with `meta` under a format whose page shape writes no `$meta`, such as `bare` (`$items`), is a compile error naming the style and the format, with the fix "write `response.body`". A style with `body` replaces the page body, as Hydra, HAL and JSON:API need; inside it, `$meta` holds the format's `meta` fields only, and those fields appear in a page only where a template writes `$meta`. `headers` and `links` add to the page in both cases.

Request roles. A style has exactly one position role (`cursor`, `page`, `offset` or `since`), or the pair `after` and `before`, which sets its kind:

| Role | Meaning |
|---|---|
| `cursor` | an opaque position the handler issued |
| `after`, `before` | a cursor kind whose two directions travel in two parameters (Stripe's `starting_after` and `ending_before`): records after the position, or before it. A request sends at most one of the two; both answer 400 |
| `page` | a page number, counted from `base` |
| `offset` | the number of records to skip |
| `since` | a changes-since token: opaque, or a `date-time` with `token: instant` (SCN-082) |
| `limit` | the page size, from 1 to the route's `maxLimit`. A larger value answers 400 (SCN-012), or, with `overLimit: clamp`, is served as `maxLimit`, which the `limit` response role then reports, as Spring Data, GitHub and API Platform do. A style without it serves `defaultLimit` records per page |
| `sort` | the sort keys of `sortable`; `style` is `signed` (`sort=-createdAt,title`), `pair` (`sort=createdAt,desc`, repeated), `keyed` (the name holds `{key}`: `order[createdAt]=desc`) or `split` (one key, its direction `asc` or `desc` in the parameter `direction` names: `sort=created&direction=desc`) |

Response roles, each a slot of the body, a header or a link:

| Role | Value | Filled by | Kinds |
|---|---|---|---|
| `items` | the page's records | handler | all |
| `nextCursor`, `previousCursor` | the cursors of the next and previous pages, absent at either end; with `after` and `before`, the values those parameters take | handler | cursor |
| `more` | whether records follow this page (Stripe's `has_more`, a `hasNext` flag) | handler | all |
| `page`, `offset`, `limit` | the request's position and the limit applied | boundary | page, offset; `limit` all |
| `from`, `to` | the one-based positions of the first and last record of the page | boundary | page, offset |
| `total` | the number of records of the whole list | handler | cursor, page, offset |
| `totalPages` | `total` divided by `limit`, rounded up | boundary | page, offset |
| `self`, `first`, `previous`, `next`, `last` | page URLs: the request URL with its position replaced | boundary | `last` page and offset only |
| `nextSince`, `complete` | the token for the next call, and whether every change up to it is included | handler | since |

The handler result is typed from the roles the style uses: the items, plus `nextCursor`, `previousCursor`, `more`, `nextSince` and `complete` when used, and `total` when the style uses `total`, `totalPages` or `last`, whether or not a template writes `$total` (a `lastPage` member without the total is that case). A page or offset style that needs no total also asks the handler for `more`, which drives `next`. A role used outside its kinds, a sort key on a style without a `sort` role, and a request name already used by the route's `query` are compile errors naming the style. The route sets the limits (`maxLimit`, `defaultLimit`, `overLimit`), or they come from `conventions.paging`.

Two third-party styles show the roles at work, Stripe's list object and GitHub's pages:

```yaml
# shared/base.yaml (excerpt)
pagings:
  stripeList:
    request:
      after: { query: starting_after }
      before: { query: ending_before }
      limit: { query: limit }
    response:
      body: { object: list, data: $items, has_more: $more, url: $path }
  githubPages:
    request:
      page: { query: page }
      limit: { query: per_page }
      sort: { query: sort, style: split, direction: direction }
    response:
      body: $items
      links: { next: $next, prev: $previous, first: $first, last: $last }
conventions:
  paging: { maxLimit: 100, overLimit: clamp }
```

### 15. The presets of the first-party packs

The template language must express every format A28 and A32 name. These are the presets of the first-party packs (ADR 0008), written in the grammar above; the packs hold the full versions.

```yaml
# @seampact/pack-api-platform: JSON-LD items and Hydra collections (excerpt)
formats:
  jsonld:
    media: application/ld+json
    success:
      item:
        body: { '@context': '/contexts/${resource}', '@id': $self, '@type': $resource, $merge: $payload }
    error:
      body:
        '@context': /contexts/Error
        '@id': '/errors/${status}'
        '@type': Error
        type: '/errors/${status}'
        title: $title
        detail: $detail
        status: $status
        code: $code
        $merge: $params
pagings:
  hydra:
    request:
      page: { query: page }
      limit: { query: itemsPerPage }
      sort: { query: 'order[{key}]', style: keyed }
    response:
      body:
        '@context': '/contexts/${resource}'
        '@id': $path
        '@type': Collection
        totalItems: $total
        member: { $each: $items, $as: { '@id': $itemSelf, '@type': $resource, $merge: $item } }
        view: { '@id': $self, '@type': PartialCollectionView, first: $first, last: $last, previous: $previous, next: $next }
```

```yaml
# @seampact/pack-jsonapi (excerpt)
formats:
  jsonapi:
    media: application/vnd.api+json
    success:
      item: { body: { data: { type: $collection, id: '${id}', attributes: $fields, links: { self: $self } } } }
    error:
      body:
        errors:
          - { status: '${status}', code: $code, title: $title, detail: $detail, meta: $params }
pagings:
  jsonapiPages:
    request:
      page: { query: 'page[number]' }
      limit: { query: 'page[size]' }
      sort: { query: sort, style: signed }
    response:
      body:
        data: { $each: $items, $as: { type: $collection, id: '${itemId}', attributes: $itemFields, links: { self: $itemSelf } } }
        links: { self: $self, first: $first, prev: $previous, next: $next, last: $last }
        meta: { total: $total }
```

```yaml
# @seampact/pack-hal (excerpt)
formats:
  hal:
    media: application/hal+json
    success:
      item: { body: { $merge: $payload, _links: { self: { href: $self } } } }
pagings:
  halPages:
    request:
      page: { query: page, base: 0 }
      limit: { query: size }
      sort: { query: sort, style: pair }
    response:
      body:
        _embedded: { $collection: { $each: $items, $as: { $merge: $item, _links: { self: { href: $itemSelf } } } } }
        _links: { self: { href: $self }, first: { href: $first }, prev: { href: $previous }, next: { href: $next }, last: { href: $last } }
        page: { size: $limit, totalElements: $total, totalPages: $totalPages, number: $page }
```

```yaml
# @seampact/pack-laravel: API Resources and paginators; errors stay the bare problem+json (excerpt)
formats:
  laravel:
    success:
      item: { body: { data: $payload } }
      table: { body: { data: $payload } }
      list: { body: { data: $payload } }
      page: { body: { data: $items, meta: $meta } }
pagings:
  laravelPages:
    absent: null
    request:
      page: { query: page }
      limit: { query: per_page }
    response:
      body:
        data: $items
        links: { first: $first, last: $last, prev: $previous, next: $next }
        meta: { current_page: $page, from: $from, last_page: $totalPages, path: $path, per_page: $limit, to: $to, total: $total }
  laravelCursor:
    absent: null
    request:
      cursor: { query: cursor }
      limit: { query: per_page }
    response:
      body:
        data: $items
        links: { first: null, last: null, prev: $previous, next: $next }
        meta: { path: $path, per_page: $limit, next_cursor: $nextCursor, prev_cursor: $previousCursor }
```

```yaml
# @seampact/pack-spring: Page; errors stay the bare problem+json, which the spring-boot target writes with ProblemDetail (excerpt)
pagings:
  springPage:
    request:
      page: { query: page, base: 0 }
      limit: { query: size }
      sort: { query: sort, style: pair }
    response:
      body:
        content: $items
        page: { size: $limit, number: $page, totalElements: $total, totalPages: $totalPages }
```

```yaml
# the core default (ADR 0006 section 7)
formats:
  bare:
    media: application/json
    error:
      media: application/problem+json
      body: { type: $code, title: $title, status: $status, detail: $detail, instance: $instance, code: $code, nature: $nature, traceId: $traceId, $merge: $params }
```

A client discriminates the error union on the member the format writes `$code` to, or, when the code sits inside a text template, matches the received text against the template to recover the code. Strict RFC 9457, with an absolute `type` and no seampact member, is one format away:

```yaml
# packs/house.yaml (excerpt): strict RFC 9457
formats:
  problem:
    error:
      media: application/problem+json
      body: { type: 'https://errors.acme.com/${code}', title: $title, status: $status, detail: $detail, instance: $instance, $merge: $params }
```

The laravel pack covers success bodies and paginators only. Laravel's validation error (`{ message, errors: { <field>: [...] } }`) groups the issues by field, which the template language does not express, so a laravel api answers problem+json errors until a consumer needs that body (lesson 5). Laravel's paginator also writes `meta.links`, a numbered list of page links. It is not a role until a consumer needs it (lesson 5): the laravel target writes the declared shape through `ResourceCollection::paginationInformation`, Laravel's own customisation point (A30).

### 16. Seeing an operation whole: `seampact explain`

One fact, one place, has a price: what a route requires and answers is spread over the tree on purpose. `updateTask` takes its identity from the surface, its scope from `channels`, its version from `tasks`, its codes from the conventions, the rights and the derivations, and only the compiler sees the whole. `seampact explain <api>.<operationId>` prints it. It compiles the workspace like `compile`, then writes the operation from the IR as YAML in the grammar's own words, each line commented with where it came from: the derivation that produced it (ADR 0006 section 5) and the file and line of the declaration or node that caused it, read through the side table (ADR 0004 section 11). The api name may be left out when the workspace has one api.

```yaml
# seampact explain tasks.updateTask
operationId: updateTask                          # ops.update, tasks/api.yaml:51
method: patch                                    # the default of the update op
path: /v1/channels/{channelId}/tasks/{taskId}
identity: user                                   # surfaces.app, tasks/api.yaml:23
schemes: [sessionCookie, bearer]                 # identities.user.schemes.write, shared/base.yaml:24
csrf: X-Csrf-Token                               # csrf.cookieWrite, schemes.sessionCookie, shared/base.yaml:3
scopes: { channel: path.channelId }              # channels.member, tasks/api.yaml:35
requires:
  - { right: tasks.update, subject: path.taskId }   # tasks/api.yaml:53; the subject defaults to the member id
input: UpdateTask                                # tasks/api.yaml:52; concurrency.version adds expectedVersion
concurrency: { version: body.expectedVersion, field: version }   # tasks, tasks/api.yaml:41
headers: { Idempotency-Key: required }           # idempotency.write, shared/base.yaml:86
errors:
  - { status: 400, code: api.schema_invalid }    # input.invalid, idempotency.write; bound at shared/base.yaml:95
  - { status: 401, code: api.unauthenticated }   # identity.authenticate; the role's default code
  - { status: 403, code: api.csrf_invalid }      # csrf.cookieWrite; the role's default code
  - { status: 403, code: api.forbidden }         # requirement.errors, rights.tasks.update, shared/base.yaml:49
  - { status: 404, code: api.not_found }         # member.notFound for path.taskId; requirement.errors; scope.errors, scopes.channel, shared/base.yaml:39
  - { status: 409, code: state.conflict }        # concurrency.version
  # and the idempotency 409 and 422, 413, 415, and 500 api.internal from conventions.errors.every
```

The output is a view, never an input: it is not a contract file, and nothing reads it back. It is deterministic, so two runs diff cleanly in review, while `seampact diff` still classifies the change (ADR 0005). It needs no new IR member: every element already carries `origin` or `derivedFrom` (ADR 0004 section 6).

## Departures from brief 5.3

| Sketch | Final | Reason |
|---|---|---|
| `api: { name, version, maturity }` only | adds `kind`, `role`, `caller`, `compat`, `documents` | FR-8, FR-13, FR-34 need them, and they are api facts |
| resources and routes in two maps at the top | one `routes` map per node; the node says its kind (`kind` or `method`) | two maps allowed the same name twice; the kind is already stated |
| top-level `resources` under an implicit surface | each surface holds its tree | several surfaces per api, each with its prefix, identity and documents |
| `prefix: /v1` | `prefix: /v{version}`, literal version refused, `pathVersion: { omit }` to opt out | the version is one fact, held on the api (FR-2); the path version is a default (A33) |
| `kind` absent | `kind: product` or `service` | "surface" already names a tree root |
| version in the input schema | added by the compiler from `concurrency`; query or header on a DELETE | one fact, and no DELETE body (A33) |
| `path: /health` | relative `path`, no leading slash, default from the node name | paths mirror the tree; a leading slash suggested an absolute path that the prefix then changed |
| children of a `single` mixed with its settings | children under `routes` | a child named like a setting (`cache`) was ambiguous |
| `collection:` and `member:` holding children | they are nodes: settings plus `routes` | settings per scope (a scope id read from the member path) |
| `ops` plus `overrides` | `ops` as a list or a mapping of op settings | one place per op; no override for an op that is not listed |
| `create` input defaults | `create` and `update` require `input` | the item schema holds fields a client never sends |
| `requires: [{ roles: {...} }]` | `{ right: roles, params: {...} }` or `{ rule: ... }` | rights and rules are two catalogues (A18); a subject must not mix with params |
| `on: pathParam` in rule params | `subject` with a value-source grammar | one grammar for every value read from the request |
| the same requirement written in full on every route | a `requirements` catalogue of named items, used by name | YAML anchors are refused (P5), and a role-gated api repeats the same right and params on many routes |
| `throttles:` | `buckets:` plus a rule with `bucket: true` | the bucket is what is counted; throttling is the rule (FR-41) |
| `identities.*.schemes.write: [session+csrf]` | `csrf` on the cookie scheme | CSRF is derived from the scheme, stated once (FR-27) |
| identity scheme names as strings | typed `schemes` catalogue | schemes are checked and emitted (FR-27) |
| no rights, scopes, signed identities | `rights`, `scopes`, `kind: signed` | A5, A18 to A25 |
| `access: { public }`, implicit optional auth | `public` and `optionalAuth`, each with a reason; a refused credential on `optionalAuth` is anonymous | brief section 7 and A33 |
| `csrfExempt` | `csrf: { exempt }` on a node; CSRF only for a cookie scheme that declares `csrf` | one exemption shape (`idempotency: { exempt }`); CSRF is opt-in (A34) |
| `idempotent: true` on a GET, `idempotent: { exempt }` | `idempotency: { exempt }` only | a GET is safe by its method; one name for the convention and the exemption |
| `errors` with fixed derived codes (`api.schema_invalid`) | derivation roles with default codes, renamed by the conventions, by `errorRoles` on any node or by a pack | a contract with no pack compiles (A34), and every code stays renamable (A20, A30, A35) |
| `errors` on routes only | codes declared or attached on any node, inherited below | A35: a resource, scope or single states its codes once |
| `nature` open | three base natures; a `natures` catalogue names others, each mapped onto a base | clients keep one retry rule (FR-6) while a contract keeps its own vocabulary (A40) |
| `conventions` on any node (5.2) | `conventions` on the api, its base and packs only | a convention is one fact for the whole api; per-node values are ordinary inherited settings (section 8) |
| identity headers written inside the identity | a `headers` catalogue, used by identities | a pack supplies header names without the identity (SCN-079) |
| no pack manifest | `pack: { name, version, extends }` and `derive` | a pack is versioned, extends packs and derives rights (ADR 0008, SCN-073) |
| `enums: { Role: [owner, editor] }` | `{ values, source or reason, fallback }` | FR-29: source, local reason, fallback |
| `examples: { 200: ... }` | named examples with `status` or `request` | examples are named (checklist volume) and may target the request |
| implicit envelopes | `conventions.format`, default bare plus problem+json | A30 |
| `$ref: ./schemas/task.yaml` only | also names (`Task`) and plain strings in schema positions; no `#/schemas/...` pointer | readability and one way to name an element; the IR is the same |
| `include` | `$include`, with an optional fragment | every loader directive is `$`-prefixed, so `include` stays usable as a field, parameter or property name (JSON:API's `include` query parameter) |
| `cache: { freshness, etag }` | adds `anonymous` and `vary` | FR-33 caller kinds |
| no workspace | `workspace.yaml` | several apis compile together for `relays` (FR-8) |
| a base per api | an api's base plus the workspace's `shared` file, each layer resolving names only in itself and the layers it builds on | a file several apis use compiles the same for each of them |
| a relaying route restating the public path, body, success and codes | a relay route (`relays`) whose shape is copied from the public operation | one fact, one place: the superset check keeps only what can still differ, the role bindings |

## Worked example: the reference tasks api

A workspace of two apis: a product api with a tenant-scoped collection under rights, a single owned by the caller, a signed webhook surface, and a service api whose route relays a public operation. Schemas are kept short; their language is ADR 0003.

```yaml
# workspace.yaml
workspace:
  apis:
    tasks: ./tasks/api.yaml
    tasksService: ./tasks-service/api.yaml
  shared: ./shared/base.yaml
```

```yaml
# shared/base.yaml: the workspace's shared file, seen by both apis
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  internalToken: { kind: bearer, bearerFormat: jwt }
  stripeSignature:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }

headers:
  deadline: { name: X-Deadline, in: request, semantic: deadline }
  trace: { name: traceparent, in: request, semantic: traceContext }
  actorSurface: { name: X-Actor-Surface, in: request, semantic: actorSurface }

identities:
  user:
    schemes: { read: [sessionCookie, bearer], write: [sessionCookie, bearer] }
    principal: UserPrincipal
  service:
    schemes: { read: [internalToken], write: [internalToken] }
    principal: ServicePrincipal
    headers:
      deadline: { for: all, required: true }
      trace: { for: all }
      actorSurface: { for: writes, required: true, schema: { enum: Surface } }
  stripe:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller

scopes:
  channel: { id: ChannelId, errors: [api.not_found] }

rights:
  roles:
    params: { allowed: { type: array, items: { enum: Role }, minItems: 1 } }
    subject: { scope: channel }
  tasks.read:
    subject: { scope: channel }
  tasks.update:
    subject: { resource: Task, id: TaskId }
    errors: [api.forbidden, api.not_found]
  tasks.seeEffort:
    subject: { resource: Task, id: TaskId }
  callerService:
    params: { allowed: { type: array, items: { enum: Service }, minItems: 1 } }

rules:
  throttle:
    bucket: true
    errors: [api.rate_limited]

buckets:
  write: { key: [principal.userId], limit: 60, window: 1m }

errors:
  api.schema_invalid:
    status: 400
    nature: refused
    params: { issues: Issues }
    example: { issues: [{ pointer: /title, rule: minLength }] }
  api.rate_limited:
    status: 429
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }

pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
      links: { next: $next }

conventions:
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB }
  cache: { families: { minute: 60s, hour: 3600s } }
  restrictedInput: reject
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
  errors:
    every: [api.internal]
    derived:
      schemaInvalid:
        code: api.schema_invalid
        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }

enums:
  Role: { values: [owner, editor, viewer], reason: "Roles are local to this product." }
  TaskState: { values: [open, done, archived], reason: "Task states belong to this api." }
  Surface: { values: [app, studio], reason: "The product's entry points." }
  Service: { values: [catalog, ticketing], reason: "The product's internal services." }

schemas:
  $include: ./schemas.yaml
```

```yaml
# shared/schemas.yaml
ChannelId: { type: string, format: uuid }
TaskId: { type: string, format: uuid }
UserId: { type: string, format: uuid }
UserPrincipal:
  type: object
  required: [userId]
  properties: { userId: UserId }
ServicePrincipal:
  type: object
  required: [service, userId]
  properties: { service: { enum: Service }, userId: UserId }
WebhookCaller:
  type: object
  required: [account]
  properties: { account: { type: string } }
Issues:
  type: array
  items:
    type: object
    required: [pointer, rule]
    properties: { pointer: { type: string }, rule: { type: string } }
Task:
  type: object
  required: [taskId, title, state, version, createdAt]
  properties:
    taskId: TaskId
    title: { type: string, minLength: 1, maxLength: 200 }
    state: { enum: TaskState }
    effort: { type: integer, minimum: 0, restrictedTo: tasks.seeEffort }
    version: { type: integer, minimum: 1 }
    createdAt: { type: string, format: date-time }
```

`tasks/schemas.yaml` (not shown) declares the api's own schemas in the same way: `Health`, `Channel`, `CreateTask` and `UpdateTask` (picked from `Task`, ADR 0003 section 2), `ArchiveTask` (its reason; `concurrency` adds `expectedVersion`), `Preferences`, `UpdatePreferences`, `DraftId`, `Draft`, `PaymentEvent`, `TaskQuery` and `TaskSearchResult`.

```yaml
# tasks/api.yaml
api:
  name: tasks
  version: 1
  kind: product
  maturity: provisional
  summary: Tasks shared inside channels.
  compat: { policy: additive-only }
  documents:
    public: { surfaces: [app], internal: exclude }
    full: {}

schemas:
  $include: ./schemas.yaml

requirements:
  channelEditor: { right: roles, params: { allowed: [owner, editor] } }
  writeThrottle: { rule: throttle, bucket: write }

surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
      health:
        method: get
        access: { public: "Probes call it before any user exists." }
        output: Health
      channels:
        kind: collection
        id: { channelId: ChannelId }
        item: Channel
        ops: [list, get]
        member:
          scopes: { channel: path.channelId }
          routes:
            tasks:
              kind: collection
              id: { taskId: TaskId }
              item: Task
              concurrency: { version: body.expectedVersion, field: version }
              ops:
                list:
                  paging: { cursor: { maxLimit: 50 } }
                  sortable: [createdAt, effort]
                  filteredBy: tasks.read
                get: {}
                create:
                  input: CreateTask
                  requires: [writeThrottle, channelEditor]
                update:
                  input: UpdateTask
                  requires: [{ right: tasks.update }]
                batch: { maxIds: 200 }
              collection:
                routes:
                  search: { $include: ./routes/tasks/search.yaml }
              member:
                routes:
                  assign:
                    method: post
                    requires: [channelEditor]
                    input:
                      type: object
                      required: [userId]
                      properties: { userId: UserId }
                    output: Task
                  archive:
                    method: post
                    concurrency: inherit
                    input: ArchiveTask
                    output: Task
                    internal: true
      me:
        kind: single
        routes:
          preferences:
            kind: single
            owner: caller
            item: Preferences
            ops:
              get: { cache: { freshness: minute, etag: true } }
              update: { input: UpdatePreferences }
          drafts:
            kind: collection
            id: { draftId: DraftId }
            item: Draft
            owner: caller
            ops:
              get: {}
              delete: { output: Draft }
  hooks:
    prefix: /v{version}/hooks
    identity: stripe
    routes:
      payments:
        method: post
        input: PaymentEvent
        responses:
          204: {}
```

```yaml
# tasks/routes/tasks/search.yaml
method: post
summary: Search the channel's tasks with a structured query.
idempotency: { exempt: "A read with a body; replaying it is harmless." }
requires: [{ right: tasks.read }]
input: TaskQuery
output: TaskSearchResult
budget: 300ms
examples:
  firstPage: { status: 200, value: { $file: ../../examples/search-200.json } }
```

```yaml
# tasks-service/api.yaml
api:
  name: tasksService
  version: 1
  kind: service
  caller: { identity: service, right: callerService }
  maturity: provisional

surfaces:
  internal:
    prefix: /internal/v{version}
    requires: [{ right: callerService, params: { allowed: [catalog] } }]
    routes:
      getTask: { relays: tasks.getTask }
```

What the example shows, by route:

- Errors: the base declares only `api.schema_invalid` (its `Issues` carry no `in`, so the role is bound with a params template) and `api.rate_limited` (an example, and a nature left to its status). Every other derived error answers its role's default code (A34), and `api.internal`, `api.not_found` and `api.forbidden` are default codes attached by name.

- `listTasks` (`GET /v1/channels/{channelId}/tasks`): identity `user` from the surface, scope `channel` from the member path of `channels`, the base's `cursor` style (the item array as the body, the next page in a `Link` header) capped at 50, the restricted sort key `effort` (it inherits `tasks.seeEffort` from `Task.effort`), `filteredBy`. A missing channel answers the scope's `api.not_found` only: the `channel` scope reads `path.channelId`, so `member.notFound` derives no second 404 for it (ADR 0006 section 5).
- `createTask`: the `writeThrottle` and `channelEditor` entries, so `throttle` then `roles` in that order, a body, an idempotency key from the conventions, CSRF from `sessionCookie` on a write.
- `updateTask`: `tasks.update` with the subject defaulting to `path.taskId`, the version read from `body.expectedVersion` and compared to `Task.version`, 409 `state.conflict`.
- `archiveTask`: a member action that opts into the version, kept out of the `public` document.
- `searchTasks`: an included route, idempotency exempt with its reason, a 300 ms budget, a named example.
- `getPreferences` and `updatePreferences`: a single owned by the caller, conditional GET; `deleteDraft` answers 200 with the deleted record.
- `payments` (`POST /v1/hooks/payments`): the signed `stripe` identity, raw body, no CSRF and no idempotency key, 204.
- `getTask` in `tasksService` (`GET /internal/v1/channels/{channelId}/tasks/{taskId}`): a relay route, its path, item and `notFound` code (`api.not_found`, from `member.notFound`) copied from `tasks.getTask`; `Task.effort` is sent whole, since a relay route has no field rights and `getTask` projects it; the service identity with its deadline and trace headers (its actor-surface header applies to writes only), `callerService` allowing `catalog`. The `channel` scope and its denial stay with the public operation.

Short forms not in the reference contract:

```yaml
# fragments, one per feature
signIn:
  method: post
  access: { public: "Signing in is how a visitor gets a session." }
  requires: [{ rule: throttle, bucket: signInPerEmail }]
  input: SignInInput
  output: Session
signOut:
  method: post
  access: { optionalAuth: "Signing out must succeed, even with an expired session." }
  csrf: { exempt: "A forged sign-out harms no one." }
  responses: { 204: {} }
updateProfile:
  method: patch
  principal: { requires: [profileId] }
  bindings: { body.profileId: principal.profileId }
  input: UpdateProfile
  output: Profile
revealStreamKey:
  method: post
  requires: [{ rule: recentAuth, params: { intent: reveal_stream_key } }]
  output: StreamKey
legacy:
  method: get
  operationId: getTaskV1
  deprecated: { sunset: '2027-06-30', successor: getTask }
  upstream: [streaming, catalog]
  maturity: { level: experimental, reason: "Kept only for old clients." }
  output: Task
getDateDetail:
  method: get
  degradable: [viewerProgress]
  output: DateDetail
listInvoices:
  method: get
  paging: { springPage: { maxLimit: 100 } }   # a preset of @seampact/pack-spring
  item: Invoice
listChanges:
  method: get
  paging: { changes: { token: opaque } }      # the style of section 14
  item: Change
github:
  method: post
  path: 'github/{workspaceId}'                # quoted: braces open a flow mapping
  pathParams: { workspaceId: WorkspaceId }
  identity: github                            # signed, reads its key from path.workspaceId
  input: GithubEvent                          # tagged by X-GitHub-Event (ADR 0003 section 3)
  responses: { 204: {} }
move:
  method: post
  summary: 'Move the task to another project of the workspace.'
  requires: [{ right: tasks.update }]
  input: MoveTask                             # holds targetProjectId
  output: Task
  errors: { api.forbidden: {} }               # the handler checks the target project
health:
  method: get
  access: { public: "Probes call it before any user exists." }
  format: { use: bare, reason: "The load balancer reads a bare body." }
  output: Health
```

A right never reads the body (section 4): it is decided before the body is validated. A check on a resource the body names, such as `move`'s target project, is the handler's: the route attaches the code the handler denies with, here `api.forbidden`, and the handler answers it as a typed error result (ADR 0012).

## Consequences

- Phase 1 writes the authoring JSON Schemas, one per file and fragment kind (section 3), from sections 1 to 13 of this ADR; a keyword not listed here is refused by it, and the grammar snapshot test (SM-6) fails when a core keyword is added without an ADR reference.
- The loader implements sections 1 to 4 (composition, the byte-identity rule, pitfalls); the compiler passes implement sections 5 to 13 as ADR 0006 assigns them.
- Contracts carry no house convention: header names, right names, page shapes and wire formats all come from the base or from packs. Derived errors have default codes in the core (A34), each renamable, so a contract with no pack compiles; a paged list still needs a paging style (A31).
- The grammar has four shorthands only: a string for a schema reference, `ops` as a list, `paging` as a style name, and a string in `requires` for a `requirements` entry. Each yields the same IR as its long form, the last one with the entry's name.
- An inherited requirement cannot be removed below; a contract that needs it must restructure its tree. Revisit only with a consumer that cannot.
- Not modelled until a consumer needs it: media types other than JSON (and the raw body of a signed identity), a base extending a base, shorthands beyond `ops`.
- YAML stays the only authoring medium (A38). A one-shot importer from an OpenAPI document into this grammar is planned for v3.

## Traceability

- FRs: FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9 (byte identity, modeline), FR-10 (extension keys, pack keywords), FR-13, FR-20 (keywords), FR-22, FR-23 (sort keys, filteredBy), FR-24, FR-27, FR-28, FR-29 (catalogue), FR-30, FR-31, FR-32, FR-33, FR-34, FR-41, FR-42. Amendments A20, A21, A23, A25, A30 to A36.
- CHK items enabled: CHK-004 to CHK-020, CHK-021 to CHK-023, CHK-027 to CHK-046, CHK-048, CHK-050 to CHK-058, CHK-073, CHK-086, CHK-087, CHK-089, CHK-090, CHK-092 to CHK-095, CHK-100.

## Self-check: scenarios and keywords

Every FEAT-001 scenario that uses contract syntax, and the keywords it needs. Scenarios about targets, distribution or CI only (SCN-015, SCN-017, SCN-020 to SCN-025, SCN-027, SCN-028, SCN-049, SCN-052 to SCN-061, SCN-074, SCN-075, SCN-089 to SCN-095, SCN-098, SCN-099) use no syntax beyond what their fixture contract borrows from the rows below. SCN-072 (framework route allow-list) is app configuration, ADR 0011 and 0012.

| Scenario | Keywords (section) |
|---|---|
| SCN-001 | `$include`, `routes`, `collection`, the byte-identity rule (2, 6) |
| SCN-002 | refused pitfalls P1 to P9, `$include` cycles (3) |
| SCN-003 | `kind: collection`, `id`, `item`, `concurrency.version`, `concurrency.field`, `ops`, `member`, `method` (6); the compiler adds `expectedVersion`, to the body of `updateTask` and to the query of `deleteTask` |
| SCN-004 | `owner: caller`, `ops` (6) |
| SCN-005 | `enums`, `enum` in a schema (12, ADR 0003) |
| SCN-006 | `examples` (`status`, `request`, `error`), `$file` (12, 2); refused keyword `if` (ADR 0003). The scenario's "TaskPage" example is the list payload, the item array, which the emitter wraps through the format |
| SCN-007 | `access.public`, `optionalAuth`, `csrf.exempt`, `idempotency.exempt`, `lint.allow`, `maturity.reason`, enum `reason`, right `guest` (9 to 12). Every route lives under a surface, so the scenario's "route outside any surface" reads as a route under a surface with no identity |
| SCN-008 | `schemes` with `csrf`, `identities.schemes.write`, `csrf.exempt` (9) |
| SCN-009 | `identity`, `principal.requires`, `scopes`, `requires` (rule and right, a `requirements` entry), `input`, `bindings` (9) |
| SCN-010 | `bindings` with body and path sources (9) |
| SCN-011 | `errors` declared in the catalogue or on a node, attached with `{}` or narrowed with `{ example }`, `reach`, `for`, `conventions.errors.every`, `errorRoles`; `seampact explain` shows each code's origin (11, 16) |
| SCN-012 | `pagings` (`cursor`, `limit`, `sort` roles), `conventions.paging.default`, `paging.<style>.maxLimit`, `sortable`, `restrictedTo` (10, 14, ADR 0003) |
| SCN-013 | `cache.freshness`, `cache.etag`, `conventions.cache.families` (10, 13) |
| SCN-014 | `workspace.apis`, `api.kind: service`, a relay route (`relays`, `operationId` to rename it), role bindings that differ between the two apis, `workspace.imports` (1, 5, 7) |
| SCN-016 | `extensions` (`at`, `schema`), the extension key pattern, `x-<prefix>-<key>` (12, 4) |
| SCN-018 | `lint.allow`, `maturity`, the `seampact/subtree-exception` rule; `sensitive` (12, 10, 8, ADR 0003) |
| SCN-019 | `api.compat.policy` (5) |
| SCN-026 | `schemes` of `kind: signature` (`name`, `format`, `algorithm`, `payload`, `encoding`, `tolerance`, `key`), `identities` of `kind: signed` (9) |
| SCN-029 | `extends`, duplicate definitions (2) |
| SCN-030 | `$ref` to a file, `$include` of a schema with a fragment, name-keyed schema files (2) |
| SCN-031 | `concurrency.version: query.<p>`, `concurrency: inherit` (6, 4). A33 accepts `header.If-Match`, which the scenario's acceptance criterion refused; the scenario follows A33 |
| SCN-032 | `api.version`, `surfaces.<s>.prefix` with `{version}`, `pathVersion.omit` (5, 6) |
| SCN-033 | `input` inline, derived names; `oneOf`, `discriminator` (7, ADR 0003, ADR 0007) |
| SCN-034 | `principal.requires` (9) |
| SCN-035 | `identity` inheritance, `routes` (8, 6) |
| SCN-036 | `access.public`, `requires` with `bucket`, `buckets` (9) |
| SCN-037 | `errors` (`status`, `nature`, `family`, `params`, `example`); the base natures and the `natures` catalogue; the error code pattern (11, 4) |
| SCN-038 | `responses` with several 2xx and `headers` (7) |
| SCN-039 | `responses` 202 with `Location`, `Retry-After` (7) |
| SCN-040 | `ops.delete` with `output` (6) |
| SCN-041 | `conventions.bodyLimit`, `bodyLimit`, `conventions.batch` (13, 10) |
| SCN-042 | `conventions.idempotency`, `idempotency.exempt` (13, 10) |
| SCN-043 | `budget` (10) |
| SCN-044 | `api.documents` with `internal: exclude`, `internal: true` (5, 10) |
| SCN-045 | `api.caller.right`, `rights.callerService.params` (5, 9) |
| SCN-046 | `# yaml-language-server` modeline on every file and fragment, `init --modelines`, `compile --editor-schemas` (3) |
| SCN-047 | `packs`, pack file keys, `pack` manifest (1, 2) |
| SCN-048 | `formats` (`success.item`, `success.table`, `meta.fill`, `error`), a `pagings` style for the list, templates, `conventions.format`, `ops.batch` (13, 14, 6) |
| SCN-050 | `api.maturity`, `api.compat` (5) |
| SCN-051 | `deprecated.sunset`, `deprecated.successor` (10) |
| SCN-054 | `sensitive` (ADR 0003) |
| SCN-062 | `rights` (`params`, `subject.scope`, `subject.resource`, `subject.id`), default subject (9) |
| SCN-063 | `rights.guest`, `access.public` (9) |
| SCN-064 | `extensions` with `at: [right]`, `x-<prefix>-<key>` on a right (12, 9) |
| SCN-065 | `restrictedTo` (ADR 0003), `access.public` (9) |
| SCN-066 | `conventions.restrictedInput`, per-field override (13, ADR 0003) |
| SCN-067 | `sortable` with `{ key, right }` (10) |
| SCN-068 | `filteredBy` (10) |
| SCN-069 | `scopes` catalogue with `within`, `scopes` on a node with `subdomain` and `path` sources (9, 4) |
| SCN-070 | `scopes` with `resolver` (9) |
| SCN-071 | `rights` (no syntax beyond SCN-062) |
| SCN-073 | `packs` with the CRUD rights pack, its `pack` manifest and `derive` entry (`select.op`, `declareRight`, `require`), `ops`, the `requires` merge order (2, 6, 8) |
| SCN-076 | `identities.principal.variants`, `schemes.optionalRead` (9) |
| SCN-077 | `schemes` (`kind`, `name`, `csrf`), `identities.schemes` (9) |
| SCN-078 | the `headers` catalogue with `deadline`, `traceContext`, `actorSurface`, their use on an identity, `budget` (9, 10) |
| SCN-079 | the `headers` catalogue in a pack (`semantic: versionToken`, `response`, `request`), the identity's use (`from`, `for`, `required`, `stale`) (9) |
| SCN-080 | `enums` (`values`, `source`, `reason`, `fallback`), narrowing (12, ADR 0003), `conventions.outputEnums` (13) |
| SCN-081 | `query` fields map with `?` and an object field (7, 4) |
| SCN-082 | a `pagings` style with the `since`, `nextSince` and `complete` roles, `paging.<style>.token`, `item` (10, 14) |
| SCN-083 | a `pagings` style with the `page` and `limit` roles, from a format pack or the contract, `paging.<style>.maxLimit`, `item` (10, 14, 15) |
| SCN-084 | `ops.batch.maxIds`, `conventions.batch` (6, 13) |
| SCN-085 | `degradable`, `conventions.degradedHeader` or a format `degraded` meta field (10, 13) |
| SCN-086 | `access.optionalAuth`, `cache.anonymous`, `cache.vary`, `sensitive` (9, 10) |
| SCN-087 | `services`, `upstream`, `maturity.level`, `maturity.reason`, `api.role: gateway` (10, 5) |
| SCN-088 | `summary`, `description` with `$file` (12, 2) |
| SCN-096 | `buckets` (`key`, `limit`, `window`), `rules.throttle.bucket`, `conventions.rateLimit` (9, 13) |
| SCN-097 | `rules.recentAuth.proof`, `params` (9) |
| SCN-100 | `packs`, the api-platform pack's `jsonld` format and `hydra` paging style (`$merge`, `$each`, the URL roles), `conventions.format`, `conventions.paging.default` (2, 13, 14, 15) |
