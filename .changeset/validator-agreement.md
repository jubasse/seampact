---
"@seampact/codegen-core": minor
"@seampact/codegen-zod": minor
"@seampact/codegen-yup": minor
"@seampact/codegen-class-validator": minor
---

The zod, yup and class-validator targets now generate `exclusiveMinimum`, `exclusiveMaximum` and `multipleOf` instead of refusing them, and yup no longer reports a bound on a value that is not an integer.
