---
---

The Laravel, Symfony and Spring Boot targets accept `null` for an opaque value only when it is nullable, on input and in replies, and a Spring handler that returns a null body now answers the format's null instead of an empty 200.
