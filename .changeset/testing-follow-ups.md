---
"@seampact/compiler": patch
"@seampact/codegen-core": patch
"@seampact/codegen-express": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-adonis": patch
---

Example dates in the years 0 to 99 are now read as written, the Node server boundaries validate a request once when a scope id or body proof is checked first, and the Express router refuses by name an app whose router stack it cannot read instead of answering another api's paths.
