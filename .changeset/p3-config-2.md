---
"@seampact/spec": minor
"@seampact/cli": minor
"@seampact/codegen-core": minor
---

- `generate` switches each artefact a target declares from the entry's `artefacts`, with `nativeDocs` off unless the target declares it on.
- `generate` checks the framework major installed where each entry's code is generated against the compatibility matrix before writing anything, tuned by `allowUntested` and `checks.matrix`.
- The app and root config schemas are published under `@seampact/spec/schemas/config/`.
