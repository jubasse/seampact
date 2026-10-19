---
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-adonis": patch
---

The generated server runtime computes its ETags, throttle keys and idempotency keys with Web Crypto, giving the same values as before, and keeps its Node-only code in separate modules so Web-standard targets can reuse the rest.
