---
---

The Spring Boot app now refuses to start when Spring MVC serves a contract handler under a path prefix that the entry's `mount` does not state, and the FastAPI, DRF and Ninja boot checks name the prefixed path where they find the api's routes.
