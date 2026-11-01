---
---

On Laravel and Symfony, the boot check now reads a route parameter that may take a `/` (a `where` of `.*`, a `.+` requirement) as a catch-all, which a `frameworkRoutes` entry allows only with `**`, never with `*`.
