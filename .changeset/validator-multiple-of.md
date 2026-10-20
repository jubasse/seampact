---
"@seampact/codegen-zod": patch
"@seampact/codegen-yup": patch
"@seampact/codegen-class-validator": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-adonis": patch
---

Generated validators now check an integer `multipleOf` step exactly, so zod, yup and class-validator no longer accept a large integer that is not a multiple of a decimal step such as 0.07.
