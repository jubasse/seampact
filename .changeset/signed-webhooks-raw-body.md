---
"@seampact/signed-webhooks": patch
---

The signed-webhooks helper now refuses a signature scheme whose payload does not hold `{rawBody}` exactly once, or whose tolerance is missing, negative or given without `{ts}`, with the codes `signature.payload.invalid` and `signature.tolerance.invalid`.
