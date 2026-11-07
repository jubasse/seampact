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

The loader applies P1 to P4 to every plain scalar (keys and values) with these expressions, so the loader implements an exhaustive list, not examples:

- P1: `^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|True|TRUE|False|FALSE)$`.
- P2: a scalar that the YAML 1.2 core schema resolves to an integer or a float and that does not match `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.
- P3: the YAML 1.1 int, float and timestamp expressions that the 1.2 core schema does not match: `^[-+]?(0b[01_]+|0[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(:[0-5]?[0-9])+(\.[0-9_]*)?|[0-9][0-9_]*_[0-9_]*|([0-9][0-9_]*)?\.[0-9_]*_[0-9_]*)$` and `^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ]|$)`.
- P4: `^(=|<<)$`.

In data positions (examples), null is written `null`; `~`, `Null`, `NULL` and an empty value are refused there too. A `$ref` resolves by name, so a cycle through it is a recursive schema, which is legal and independent of the file layout (ADR 0003 section 2).

No keyword of the grammar is a word that YAML 1.1 reads as a boolean (`on`, `off`, `yes`, `no`), so a keyword never needs quoting. Prose is another matter: in a flow mapping (`{ ... }`), a plain value ends at `, ` or `: `, so `{ title: No such workspace, or not a member. }` holds two keys. Quote prose (`title`, `summary`, `reason` and every docs string) in a flow mapping, or write it in block style; the examples of the ADRs do. A plain mapping key is a string, except in a mapping keyed by HTTP status (`responses`), where keys are plain integers: a success from 200 to 299, or a redirect, 301, 302, 303, 307 or 308 (section 7). Error statuses come from codes (section 11), and 304 is derived from `cache.etag`.

One comment has a meaning, to editors only: the modeline, the first line of a contract file, fragments included (FR-9, SCN-046). It is optional, and `compile` never reads or checks it. `@seampact/spec` publishes an authoring schema per file kind (workspace, api, base, pack) and per fragment kind, that is, per mapping an include site may expect: a tree node, a name-keyed catalogue file (`schemas`, `errors`, `rights` and the other catalogues), a node's `errors` map, `conventions`, a schema. A fragment's kind is the one its include site expects. `seampact init` writes the modeline of each file it creates, and `seampact init --modelines` writes or corrects the modeline of every file of an existing workspace, taking each fragment's kind from its include site.

Those schemas check keywords only. `seampact compile --editor-schemas` checks names too: it writes to the directory `workspace.editorSchemas` names (`.seampact/schemas` by default) the same schemas specialised for the workspace, where every position that names a declaration (`identity`, `right`, a `requires` entry, `enum`, an error code, `paging`, a schema reference) lists the names the workspace declares, each described by the file and line that declares it. An editor then flags a misspelt name and offers the declared ones as you type; `compile --watch` keeps them current. `init` writes them once, adds that directory to `.gitignore`, and points the modelines there, relative to each file; a fresh checkout runs `compile --editor-schemas` once. Each of these is the user's choice (A36): `workspace.editorSchemas` names the directory (`.seampact/schemas` by default); `init --editor-schemas=ignore` (the default) git-ignores it, `commit` keeps it in the repository so a fresh checkout has it at the cost of a diff on each new declaration, and `none` writes none and points the modelines at the installed `@seampact/spec`, which checks keywords only; `--no-modelines` writes no modeline and `--no-ignore-files` touches no ignore file. `init` prints every file it creates or changes. No language server is needed for this; go-to-definition and rename wait for a consumer that asks (lesson 5). The included route of the worked example, `tasks/routes/tasks/search.yaml`, would start:

```yaml
# yaml-language-server: $schema=../../../.seampact/schemas/node.schema.json
method: post
requires: [{ right: tasks.reed }]   # flagged: the right must be one of callerService, roles, tasks.read, tasks.seeEffort, tasks.update
```
