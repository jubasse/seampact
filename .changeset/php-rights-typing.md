---
---

The Laravel and Symfony decide request now carries a right's or rule's params as its generated params class instead of a `stdClass` (null for one without params), and both targets refuse by name the extension values of a right, rule or scope an operation uses instead of dropping them.
