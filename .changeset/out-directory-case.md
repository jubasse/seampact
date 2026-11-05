---
"@seampact/cli": patch
"@seampact/codegen-core": patch
---

Two target entries whose `out` directories differ only by letter case, or sit one inside the other once case is ignored, are now refused with `config.out.case-overlap` by every config reader, since a case-insensitive disk would make one entry overwrite or prune the other's files.
