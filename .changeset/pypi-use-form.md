---
"@seampact/spec": minor
"@seampact/cli": patch
---

An app config's target `use` accepts `pypi:<distribution>` for a pip target, which the Node, JVM and PHP runners leave to it, and a `pypi:` name that is not PEP 503 normalised is refused with its rule.
