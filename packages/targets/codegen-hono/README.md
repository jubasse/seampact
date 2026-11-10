# @seampact/codegen-hono

Seampact target for Hono 4: generates a registerRoutes function that adds each contract route with access, validation and reply checks around your handler map.

```sh
npm install --save-dev @seampact/codegen-hono
```

Guide: https://jubasse.github.io/seampact/backend/hono/

Generates a registerRoutes function per api that adds each contract route to a Hono 4 app with its access, validation and reply checks around your handler map, validating with zod.
