---
"@seampact/spec": patch
"@seampact/compiler": patch
---

`deprecated` now requires a `since` date, both dates must name real calendar days with `since` not after `sunset`, and a successor's path params must be path params of the deprecated route, of the same type.
