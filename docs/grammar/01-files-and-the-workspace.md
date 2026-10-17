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
- `workspace.editorSchemas` names the directory `compile --editor-schemas` writes to, relative to the root (`.seampact/schemas` by default, section 3).
- `workspace.imports` names an api held in a pinned contract bundle, so a `relays` can target it without its sources. An entry takes one source form of the app config's `sources` (ADR 0011: `package` with `version`, `release`, or `git`), `api`, the api's name inside the bundle, and `integrity`, which is required. The bundle passes ADR 0011's pinned-bundle check before its IR is read; a missing `integrity` fails and prints the actual value, so pinning is a copy.

There are five kinds of file. The loader knows each by its top-level keys.

| File | Top-level keys | Reached by |
|---|---|---|
| workspace | `workspace` | the CLI |
| api | `api`, `extends`, `packs`, `surfaces`, any catalogue, `conventions`, `formats`, `extensions`, `lint` | `workspace.apis` |
| base | any catalogue, `packs`, `conventions`, `formats`, `extensions`, `lint` | `extends` from an api, or `workspace.shared` |
| pack | `pack`, any catalogue, `conventions`, `formats`, `extensions`, `lint`, `derive` | `packs` from an api or base, `extends` from a pack |
| fragment | whatever the include site expects | `$include` or a file `$ref` |

The catalogues are `schemas`, `enums`, `scalars` (named formats, ADR 0003 section 8), `errors`, `natures` (error natures, section 11), `schemes`, `headers` (identity headers, section 9), `identities`, `rights`, `rules`, `requirements` (named requirement items, section 9), `scopes`, `buckets`, `services` and `pagings` (section 14). `formats` (section 13) is keyed by name like a catalogue. Each maps a name to one declaration. Everything a contract references by name lives in one of them.

Paths in `extends`, `packs`, `$include`, `$ref` and `$file` are relative to the file that contains them, use forward slashes, must stay inside the workspace root, and must match the case of the file on disk. The last two rules keep compilation identical on case-insensitive file systems and stop a contract from reading files outside its repository.
