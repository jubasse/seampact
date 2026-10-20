---
"@seampact/spec": minor
"@seampact/cli": minor
"@seampact/codegen-core": minor
---

`generate` now switches each artefact a target declares from the entry's `artefacts` (`nativeDocs` off unless the target declares it on), checks the installed framework major against the compatibility matrix before writing anything (`allowUntested` and `checks.matrix` tune it), and the app and root config schemas are published under `@seampact/spec/schemas/config/`.
