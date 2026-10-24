---
"@seampact/codegen-core": patch
---

The generated React query hooks no longer need `AbortSignal.any`, so they run on React Native's Hermes.
