---
---

The Laravel and Symfony decide request now carries a right's or rule's params as its generated params class instead of a `stdClass` (null for one without params), and both targets refuse by name the extension values of a right, rule or scope an operation uses instead of dropping them.

The Laravel and Symfony servers now ask a separate decision for each output field restricted to one right with other params, instead of reusing the first field's decision for the others.
