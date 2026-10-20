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
    select: { op: [list, get, create, update, delete, batch] }   # batch: tasks.batch, subject the innermost scope
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

`pack` is the manifest: `name` (the package name, or for a pack referenced by path a name of the contract's choosing, never holding `#`: the name is the layer id `pack:<name>`, which the side table joins to a pointer with `#`, ADR 0004 section 11), `version` (semver) and `extends` (packs applied just before this one, in the reference forms of `packs`). The version is written once, in the manifest: for a pack resolved from a package, the compiler refuses a `package.json` whose version differs.

`derive` is the only way a pack adds to what a route ends up with (ADR 0008). It is a list of entries, applied in order; each has an `entry` name, unique in the pack, a selector and one or more effects, all from closed sets:

| Key | Meaning |
|---|---|
| `select` | criteria a route must all match, each a list of accepted values: `op` (`list`, `get`, `create`, `update`, `delete`, `batch`: the `ops` name the route came from), `access` (`read` for a safe route, `write` otherwise), `apiKind` (`product`, `service`), `identity`, `tag` |
| `declareRight` | `{ name, subject, errors }`: declares the right the `name` template gives. `subject.member` (on member routes) is `resource`, the item schema with the member id, or `none`; `subject.collection` (on other routes) is `innermostScope` or `none`; `innermostScope` on a route with no scope above it gives `none`. When the catalogue already declares that name, the declared right is used and its subject must be the one the entry would give |
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
- Settings (`conventions`, and `lint.rules`) are overridden by leaf path. A leaf is a scalar, or a list taken as one value; `errors.every` is the exception, a union of every layer's list. Maps of named entries (`cache.families`, `errors.derived`) merge per entry, each entry being a leaf. An api writing `paging: { maxLimit: 50 }` therefore keeps a pack's `paging.default`.
- A later layer wins, and the IR records the origin of every leaf (ADR 0004). A base shared by several apis can thus be overridden by one of them; an override states a different value, not a second copy of the same fact.

Clarification (p1-loader review): a `derive` entry name is unique across every layer of an api, not only within its pack. "Unique in the pack" (Packs, above) is the case of two entries in one pack; two packs whose entries share a name are a declaration made by two layers, refused with both locations, although `derivedFrom` (`pack.<pack>.<entry>`) could tell them apart. A pack therefore names its entries so that they do not collide with the packs it may be applied beside.

#### The byte-identity rule

A route declared inline and the same route moved to a file reached through `$include` compile to byte-identical IR (FR-1, FR-9, SCN-001). The grammar guarantees it with five rules:

1. The IR never depends on which file a node came from, nor on the order of keys in a mapping, with one exception: the members of a generated type (`properties` of an object schema, and fields maps) keep their written order, so generated code lists fields as the author wrote them ([A33](../decisions.md#a33)). `$include` never reorders anything: its keys take its position. Order is otherwise meaningful only in sequences; ADR 0004 lists the sequences whose order the IR keeps (`requires`, `upstream`, enum `values`, among others) and sorts every other sequence as a set.
2. `$include` replaces itself with the file's mapping before any other step; after it, the tree is the same as if the content had been written inline.
3. Relative paths inside an included file resolve against that file, so moving content and fixing its relative paths reaches the same files; the IR stores the content of `$file` and `$ref` targets, never a path.
4. Names that the compiler derives (operation ids, inline schema names, ADR 0007) come from the position in the tree and the role, never from a file name.
5. Source locations (file, line, column) live only in the side table (ADR 0004). An element's `origin` in the IR is a layer and a JSON Pointer into the merged tree (ADR 0004 section 6), such as `{ layer: api, pointer: /surfaces/app/routes/channels/member/routes/tasks }`, which does not change when content moves between files.

The loader's property test externalises random nodes of generated trees and asserts byte equality of the IR.
