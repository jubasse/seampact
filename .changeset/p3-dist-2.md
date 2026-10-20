---
"@seampact/compiler": minor
"@seampact/spec": minor
"@seampact/cli": minor
---

Read contract bundles from an npm package, a release asset or a git tag in `compile` and `generate` (pinned, checked and cached by integrity), relay to apis held in pinned bundles through `workspace.imports`, and refuse local sources with `allowLocal: false` or `SEAMPACT_ALLOW_LOCAL=false`.
