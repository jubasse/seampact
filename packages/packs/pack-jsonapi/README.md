# @seampact/pack-jsonapi

Seampact convention pack for JSON:API: resource objects, page[number] paging and the errors array.

```sh
npm install --save-dev @seampact/pack-jsonapi
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares the `jsonapi` format (`application/vnd.api+json`, resource objects, an `errors` array) and the `jsonapiPages` paging style (`page[number]`, `page[size]`, signed `sort`).

- Sets `conventions.format: jsonapi` and `conventions.paging.default: jsonapiPages`; a later layer may choose others.
- A resource object needs an id: a route of a single or of no collection (which has none) takes `format: bare`. Refuses, until a consumer needs it, a JSON:API id for a single.
