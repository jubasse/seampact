---
---

On FastAPI, Django REST framework and Django Ninja, a decider now receives a right's or rule's params as an instance of its generated params class (for example `RolesParams`), or None when it declares none, and `RequirementRequest.params` is typed `object | None`.
