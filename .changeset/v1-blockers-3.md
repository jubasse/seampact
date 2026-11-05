---
"@seampact/server-runtime": patch
---

Spring answers a bare 404 for an unserved path under an api's base path when no operation has the `notFound` role, instead of passing it to the app, and the Node, Laravel and Symfony boot checks allow-list a route with an optional parameter only when `frameworkRoutes` also lists the path without it.
