---
---

The Spring Boot target writes item, table and list bodies in their format's success envelope, refuses by name a format it cannot render (`$merge: $payload`, the HAL, JSON-LD and JSON:API item formats) instead of writing a bare payload, and refuses a sort key a right restricts and a non-finite number inside an opaque value, as the Laravel and Symfony targets do.
