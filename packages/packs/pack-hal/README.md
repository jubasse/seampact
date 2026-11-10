# @seampact/pack-hal

Seampact convention pack for HAL: items and pages with _links and _embedded, and Spring HATEOAS's page object.

```sh
npm install --save-dev @seampact/pack-hal
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares the `hal` format (`application/hal+json`, items merged with `_links.self`) and the `halPages` paging style (`_embedded`, `_links` and Spring HATEOAS's `page` object).

- Sets `conventions.format: hal` and `conventions.paging.default: halPages`; a later layer may choose others.
- Errors stay the bare problem+json.
