---
"@seampact/codegen-ts": minor
---

Generate per-api `Status` and `ErrorCode` constants, so a handler returns `{ status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }` without `as const`.
