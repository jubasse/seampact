---
"@seampact/compiler": patch
---

The compiler writes the `schemes`, `headers` and `identities` catalogues and reports their errors: a scheme or header missing a required member, an undeclared or wrong-kind scheme reference, a signature scheme whose keys, algorithm, templates or tolerance do not fit its verify form, a principal that is not a named schema, and an identity header use that does not fit its declaration.
