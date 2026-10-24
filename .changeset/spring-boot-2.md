---
---

A Spring Boot 4 app built with the Gradle plugin now runs the contract's boundary itself: it routes, validates and authorizes each request through your hook beans, checks every reply against the contract, and refuses to start when a hook, a handler or a framework route is missing.
