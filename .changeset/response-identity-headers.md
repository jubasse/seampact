---
"@seampact/codegen-core": patch
"@seampact/codegen-msw": patch
---

Every server target and the MSW mocks now refuse at generation an identity header written on a response (a `versionToken` header, or one declared `in: response`) by name as `identity.response.header.unsupported`, instead of warning and leaving it unwritten.
