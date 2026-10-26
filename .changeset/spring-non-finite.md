---
---

A Spring Boot app now answers 400 `type` for a number past the range of a double and 400 `minimum` or `maximum` for an integer past 2^53 - 1, instead of a 500 or a value the handler could not trust.
