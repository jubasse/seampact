# Contract

Use these pages to write the contract. Each page is one task. They build on [Write the contract](../getting-started/02-first-contract.md).

- [The shape of a contract](01-basics.md): api, surfaces, collections, routes and how settings flow down the tree.
- [Types and references](02-types-and-refs.md): schemas, enums, optional and nullable, split files.
- [Errors](03-errors.md): declare a code, attach it, rename a built-in one.
- [Access](04-access.md): public routes, identities and rights.
- [Lists](05-lists.md): paging styles, sorting, unpaged lists.
- [Versioning and change](06-versioning.md): path version, maturity, deprecation.
- [Advanced](07-advanced.md): uploads, downloads, lost updates, cache.

A snippet that starts at a route name goes under `surfaces.<surface>.routes`; one that starts at `errors:`, `pagings:` or `schemas:` is a top-level block. Each snippet names its place in a first-line comment.

Next: [The shape of a contract](01-basics.md). Every key is in the [grammar](../grammar/05-the-api-file.md).
