---
"@seampact/server-runtime": minor
"@seampact/codegen-core": minor
"@seampact/codegen-express": minor
"@seampact/codegen-hono": minor
"@seampact/cli": patch
---

Express and Hono servers now import their request checks from the new `@seampact/server-runtime` package instead of copying them into each api, and `seampact generate` and the server's start refuse a runtime of another version.
