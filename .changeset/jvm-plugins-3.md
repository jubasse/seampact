---
"@seampact/spec": minor
---

The Gradle and Maven plugins check the Spring Boot version against the compatibility matrix with `checks.matrix` and `allowUntested`, refuse `springSecurity: { matchers: true }` without `spring-security-config`, and are smoke-tested on release, git and HTTPS bundle sources.
