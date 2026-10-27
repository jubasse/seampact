---
---

On Spring Boot, a handler that returns a null list, table or page, or a result that breaks its own type, now gets the api's 500 under `responses: warn` too, as on the Node servers, instead of an empty 200.
