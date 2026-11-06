---
"@seampact/http-suite": patch
---

A pack profile now answers a default case's scripted page with its items' count when the pack's paging style asks the handler for the total, so the Node servers run the `pack:laravel` profile from the same cases as Spring Boot and Laravel.
The Laravel, Symfony, FastAPI, DRF and Django Ninja targets now refuse by name, at generation, a page that writes a slot their boundary does not fill yet (`$resource`, `$collection`, an item's id or URL, or `$page` under an offset style), where they left it out of the body.
