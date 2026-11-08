---
"@seampact/server-runtime": minor
"@seampact/codegen-core": minor
"@seampact/codegen-express": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-hono": minor
---

Express, Fastify and Hono servers take typed `inputRules` beside `hooks`: your own zod, yup or Ajv rules run after the contract's checks and answer its schema-invalid error with `app.<name>` issues.
