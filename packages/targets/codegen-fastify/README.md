# @seampact/codegen-fastify

Seampact target for Fastify 5: generates a plugin per api that registers each contract route with access, validation and reply checks around your handler map.

```sh
npm install --save-dev @seampact/codegen-fastify
```

Guide: https://jubasse.github.io/seampact/backend/fastify/

Generates a Fastify plugin per api that registers each contract route with its access, validation and reply checks around your handler map, on Fastify 5, validating with the zod or yup link you give or with Ajv validators it generates.
