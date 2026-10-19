---
"@seampact/compiler": patch
---

An operation that refuses undeclared query keys now declares the schema-invalid 400 even without input, so `GET /v1/health?x=1` answers 400 instead of 500.
