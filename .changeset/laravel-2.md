---
---

Generated Laravel apis now check each request at the boundary (raw path, body limit, authentication, scopes, rights and the outgoing reply) and refuse to boot when a hook, a handler or a contract route is missing.
