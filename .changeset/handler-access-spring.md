---
---

A Spring Boot handler now reads its caller from its input: `principal()` is the authenticated principal, null for an anonymous caller, and `scopes()` holds each resolved scope.
