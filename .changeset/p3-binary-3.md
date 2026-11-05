---
---

A released `seampact/ir` or `seampact-ir` now downloads the pinned compiler binary over HTTPS (from the GitHub release, a `version` override or a mirror `url`), checks its SHA-256 before it runs and caches it, and every runner refuses a `0.0.0` development pin by name.
