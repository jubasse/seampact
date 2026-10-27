---
"@seampact/codegen-core": patch
---

The Node and Spring Boot targets now refuse at generation a contract path whose static segment a client would percent-encode or a server cannot read raw (a space, `{`, `}`, `|`, `[`, `]`, a control or non-ASCII character), the same set on every target, as Laravel and Symfony do, and Symfony no longer adds an exception's `Retry-After` to the api's logged 500.
