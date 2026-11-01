---
"@seampact/spec": patch
"@seampact/cli": patch
---

An app config's `allowUntested` entry can now name a 0.x framework by its minor (`fastapi@0.162`), while a major of 1 or more still takes no minor; `@0` alone is no longer accepted.
