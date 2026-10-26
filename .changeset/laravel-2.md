---
---

Generated Laravel apis now check each request at the boundary (raw path, body limit, authentication, scopes, rights, rules and the outgoing reply), refuse to boot when a hook, a handler or a contract route is missing, and generate with `php artisan seampact:generate`.
