---
"@seampact/diff": patch
"@seampact/spec": patch
---

`@seampact/diff` compares two IRs of one api, classifies each change as additive or breaking for clients and servers, gates the release on `compat.policy` (configurable with the app config's `diff` key), refuses breaking changes on stable operations and reports deprecations and sunsets.
