# @seampact/pack-laravel

Seampact convention pack for Laravel API Resources and paginators: data wrapping, length-aware and cursor pages.

```sh
npm install --save-dev @seampact/pack-laravel
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares the `laravel` format (`data` wrapping for items, tables and lists, `{ data, meta }` for pages) and the `laravelPages` and `laravelCursor` paging styles.

- Sets `conventions.format: laravel` and `conventions.paging.default: laravelPages`; a later layer may choose others.
- Errors stay the bare problem+json. Refuses, until a consumer needs them, Laravel's validation error body (issues grouped by field) and the paginator's `meta.links`.
