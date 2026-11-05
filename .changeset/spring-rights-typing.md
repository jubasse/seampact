---
---

Spring Boot now reads and writes an optional nullable member (`Field<T>`) as absent, null or a value instead of failing on a sent value.

Spring Boot now carries a right's or rule's params in the decide request as its generated params record instead of a raw JSON node (empty for one without params).

Spring Boot now refuses by name the extension values of a right, rule or scope an operation uses instead of dropping them.

Spring Boot now asks a separate decision for each output field restricted to one right with other params, instead of reusing the first field's decision for the others.
