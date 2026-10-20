---
"@seampact/pack-crud-rights": minor
"@seampact/pack-api-platform": minor
"@seampact/pack-laravel": minor
"@seampact/pack-spring": minor
"@seampact/pack-jsonapi": minor
"@seampact/pack-hal": minor
"@seampact/compiler": patch
"@seampact/openapi": patch
---

Add the six first-party convention packs as data (CRUD rights, API Platform, Laravel, Spring, JSON:API, HAL) with golden contracts for all but JSON:API, let a CRUD right on an unscoped route take no subject, let the OpenAPI emitter write `$each`, `$resource` and a member named after the collection, and let a format read `$collection` in an item and `$self` on a route whose item has no id.
