# @seampact/pack-hal

Declares the `hal` format (`application/hal+json`, items merged with `_links.self`) and the `halPages` paging style (`_embedded`, `_links` and Spring HATEOAS's `page` object).

- Sets `conventions.format: hal` and `conventions.paging.default: halPages`; a later layer may choose others.
- Errors stay the bare problem+json.
