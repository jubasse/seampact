---
"@seampact/codegen-core": patch
---

A run that would generate two files or folders whose names differ only by case (`Tasks.ts` and `tasks.ts`), or rename a generated file only by case on a case-insensitive disk, is now refused by name before anything is written, with the same rule in the Node, PHP, JVM and Python writers.
