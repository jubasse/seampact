# @seampact/pack-laravel

Declares the `laravel` format (`data` wrapping for items, tables and lists, `{ data, meta }` for pages) and the `laravelPages` and `laravelCursor` paging styles.

- Sets `conventions.format: laravel` and `conventions.paging.default: laravelPages`; a later layer may choose others.
- Errors stay the bare problem+json. Refuses, until a consumer needs them, Laravel's validation error body (issues grouped by field) and the paginator's `meta.links`.
