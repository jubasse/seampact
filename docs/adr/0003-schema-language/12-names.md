### 12. Names

Every named schema becomes a named type in every target. An inline schema gets a deterministic name from its position: the operation and the role (`assignTask` input gives `AssignTaskInput`), an inline property from its parent and the property name, an inline union variant from the union and its tag. Names are word segments plus a role in the IR; casing and escaping are per target (ADR 0007). Generated code never contains an anonymous structural type (SCN-033).
