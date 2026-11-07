## seampact

The API is declared in `contract/` and `seampact.config.yaml`. They are the source of truth.

- Change the API in the contract. Never edit the generated folder (`outDir` in the config): `generate` rewrites it and `check` fails on a hand edit.
- After each contract or config change run these three in order and fix what they print:
  1. `{{seampact}} lint`
  2. `{{seampact}} generate`
  3. `{{seampact}} check`
- Handlers are yours. They implement the generated interfaces. Read the generated types instead of guessing a name or a signature, then run your compiler.
- Every error ends with `Fix:`. Apply it when it edits only your code or the contract syntax. If it removes an operation, a header or an option, or says "not generated yet", stop and ask the user: that changes what the API does.
- One operation, whole: `{{seampact}} explain <api>.<operationId>`. What a contract edit breaks for clients: `{{seampact}} diff --against <baseline>`.
- Never hand-write a route, validator, DTO or OpenAPI entry for a contract operation.

Docs by task: https://jubasse.github.io/seampact/llms.txt
Skills in `{{skillsDirectory}}/`; if your tool does not load skills, read the one that matches before you start:
- `seampact-change-contract/SKILL.md`: add or change a route, schema, error, access rule, paging.
- `seampact-implement-handler/SKILL.md`: write or fix handler code after `generate`.
- `seampact-fix-error/SKILL.md`: any seampact error code or a failed `check`.
- `seampact-setup/SKILL.md`: add a target, a framework or a new api.
