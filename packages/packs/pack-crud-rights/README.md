# @seampact/pack-crud-rights

Seampact convention pack that derives a <resource>.<op> access right for every list, get, create, update, delete and batch route.

```sh
npm install --save-dev @seampact/pack-crud-rights
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares one `derive` entry, `crud`: a right `{resource}.{op}` for every `list`, `get`, `create`, `update`, `delete` and `batch` route, required first in the route's `requires`.

- A member route takes the resource as subject; a collection route takes its innermost scope, and none when it has no scope above it.
- A route that already lists the right does not get it twice; a right the contract declares keeps its own subject.
- Sets no setting, so a later layer has nothing to override; it refuses a right whose subject differs from the one the contract declares (`pack-right`).
