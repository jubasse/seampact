# Contract content errors: tree

Codes that start with `seampact/tree/` say your routes or schemas do not fit together.

| You see | Do |
|---|---|
| `seampact/tree/schema-unknown` | A schema name is not declared. Declare it under `schemas`, or fix the name. |
| `seampact/tree/required-unknown` | `required` lists a property the object does not have. Declare it or remove it. |
| `seampact/tree/schema-cycle` | A schema reaches itself without an object in between. Break the cycle with a named object. |
| `seampact/tree/paging-style` | A `list` names no paging style. Declare your page shape under `pagings` (the error shows an example) and name it in `paging`, or write `paging: none`. See [Lists](../contract/05-lists.md). |
| `seampact/tree/paging-unknown` | The style is not declared under `pagings`. Declare it or fix the name. |
| `seampact/tree/path-param` | A path holds `{who}` and nothing declares it. Declare it in `pathParams`. |
| `seampact/tree/path-segment` | A route `path` is relative segments: no `/` at either end. |
| `seampact/tree/collection-singular` | A collection with no `id` needs `singular: note` for the names it derives. |
| `seampact/tree/format-unknown` | The `format` is not a portable format. Declare it under `scalars`, or write a portable one such as `uuid`. |
| `seampact/tree/api-version` | The api version is a label such as `v1`, but the path has `{version}`. Write an integer, or set `pathVersion: none`. |

See [Types and references](../contract/02-types-and-refs.md) and [Lists](../contract/05-lists.md).
