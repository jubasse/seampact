---
"@seampact/compiler": patch
---

The compiler derives each operation's body limit, the api's unknown-key policy, the credential, CSRF, identity, union tag and idempotency headers (the identity ones optional on an optional-auth route), and refuses an incomplete idempotency convention, an idempotency exemption no key reaches and a derived name that clashes with another, once per authored fault.
