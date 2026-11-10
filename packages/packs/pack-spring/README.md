# @seampact/pack-spring

Seampact convention pack that gives an API Spring Data's Page as its paging style.

```sh
npm install --save-dev @seampact/pack-spring
```

Guide: https://jubasse.github.io/seampact/features/convention-packs/

Declares the `springPage` paging style (zero-based `page`, `size`, `sort=key,desc`; a `content` array and a `page` object).

- Sets `conventions.paging.default: springPage`, and no format, so errors stay the bare problem+json; a later layer may choose another style.
