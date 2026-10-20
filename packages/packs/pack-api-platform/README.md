# @seampact/pack-api-platform

Declares the `jsonld` format (`application/ld+json`, items merged with `@context`, `@id` and `@type`, a Hydra error body), the `hydra` paging style (`page`, `itemsPerPage`, `order[{key}]`) and the `iri-reference` named format.

- Sets `conventions.format: jsonld` and `conventions.paging.default: hydra`; a later layer may choose others.
- Refuses, until the API Platform target needs it, a second format `jsonldProblem` with problem+json errors: a contract that wants them declares its own format.
