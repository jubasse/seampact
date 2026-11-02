---
"@seampact/codegen-core": patch
---

A run that would generate two files whose paths differ only by case (`Tasks.ts` and `tasks.ts`) is now refused by name before anything is written, in the Node, PHP, JVM and Python writers.
