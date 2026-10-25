---
"@seampact/signed-webhooks": patch
---

The signed-webhooks helper now refuses a signature scheme whose payload does not hold `{rawBody}` exactly once, or signs `{ts}` without a tolerance, instead of verifying it.
