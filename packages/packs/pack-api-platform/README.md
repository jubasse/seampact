# @seampact/pack-api-platform

Seampact convention pack for API Platform: JSON-LD items, Hydra collections and the iri-reference format.

```sh
npm install --save-dev @seampact/pack-api-platform
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares the `jsonld` format (`application/ld+json`, items merged with `@context`, `@id` and `@type`, a Hydra error body), the `hydra` paging style (`page`, `itemsPerPage`, `order[{key}]`) and the `iri-reference` named format.

- Sets `conventions.format: jsonld` and `conventions.paging.default: hydra`; a later layer may choose others.
- Refuses, until the API Platform target needs it, a second format `jsonldProblem` with problem+json errors: a contract that wants them declares its own format.
