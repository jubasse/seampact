# Contract file errors: load

Codes that start with `seampact/load/` come from reading your YAML files. They print as `api.yaml:5:13: error seampact/load/yaml-boolean: ...`: file, line, column, code.

| You see | Do |
|---|---|
| `seampact/load/yaml-syntax` | Fix the YAML at that position. Look for a missing `]`, `}` or quote, or a wrong indent. |
| `seampact/load/workspace-shape` | The file must start with `api:` or `workspace:`. Often a YAML syntax error is the real cause: fix the `yaml-syntax` line first. |
| `seampact/load/yaml-boolean` | A plain `off`, `no` or `yes` is a boolean in YAML 1.1. Quote it: `'off'`. |
| `seampact/load/yaml-ambiguous-scalar` | A value such as `1_00` reads as a number or a string depending on the parser. Quote it. |
| `seampact/load/yaml-number-format` | Write the number in plain decimal, or quote it. |
| `seampact/load/scalar-type` | The value has the wrong type, for example a number where a mapping goes. Write what the message names. |
| `seampact/load/duplicate-key` | A key appears twice in one mapping. Remove one. The message points at the first. |
| `seampact/load/file-missing` | A `$include` or `$ref` file does not exist. Create it or fix the path. |
| `seampact/load/include-cycle` | Files include each other. Break the loop. |
| `seampact/load/path-escape` | A path leaves the workspace. Move the file inside, or put a `workspace.yaml` above every file the contract reads. |
| `seampact/load/pack-not-found` | Install the pack package, or write the pack as a path: `./packs/name.yaml`. |
| `seampact/load/declaration-twice` | Two layers declare the same name, even when the copies are identical. Remove one copy. |
| `seampact/load/name-not-visible` | A shared file or base uses a name only an api declares. Move the declaration into the shared file or the base. |

See [The shape of a contract](../contract/01-basics.md).
