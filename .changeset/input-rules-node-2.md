---
"@seampact/server-runtime": minor
"@seampact/codegen-core": minor
"@seampact/codegen-nestjs": minor
"@seampact/codegen-adonis": minor
---

NestJS and AdonisJS servers take typed `inputRules` (in `forRoot` and `registerRoutes`): your own class-validator, VineJS, zod or yup rules run after the contract's checks and answer its schema-invalid error with `app.<name>` issues.
