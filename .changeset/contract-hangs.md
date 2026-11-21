---
"@seampact/compiler": patch
"@seampact/spec": patch
---

The compiler refuses polynomial backtracking patterns, checks the `conventions.errors.pattern` and `conventions.rights.pattern` patterns like schema patterns, walks long reference, enum source and scope chains without a stack overflow or a cubic cost, quotes a written rights pattern in its message, and refuses lengths and item counts above 2^53 - 1 with a located diagnostic.
