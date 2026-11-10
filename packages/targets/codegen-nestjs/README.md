# @seampact/codegen-nestjs

Seampact target for NestJS: generates operation decorators, the access guard, validating input pipes, the error filter and a boot check around your controllers.

```sh
npm install --save-dev @seampact/codegen-nestjs
```

Guide: https://jubasse.github.io/seampact/backend/nestjs/

Generates the NestJS boundary around your controllers: a decorator per operation, the access guard, an input decorator whose pipe validates, a handler wrapper or opt-in reply interceptor that writes the checked reply, the error filter and a boot check, validating with zod.
