---
"@seampact/cli": patch
"@seampact/codegen-core": patch
---

Two target entries whose `out` directories differ only by letter case or by how an accent is written, or sit one inside the other once those are ignored, are now refused with `config.out.case-overlap` by every config reader, since a case-insensitive or normalising disk would make one entry overwrite or prune the other's files.
