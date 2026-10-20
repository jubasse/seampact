# Project layout

What the guide leaves in your app folder.

```text
notes-app/
  seampact.config.yaml     what to generate and check
  contract/api.yaml        your contract
  openapi/notes.yaml       generated OpenAPI document
  src/
    __generated__/         generated code, never edit
      types/ validators/ server/
    notes-controller.ts    your handlers
    main.ts                your app
  vendor/                  seampact packages from your checkout, git-ignored
```

- Edit `contract/`, `seampact.config.yaml` and your own files in `src`.
- Commit `src/__generated__` and `openapi/`: `seampact check` compares them with the contract.
- Add `vendor` and a `baseline` folder (from [diff](../features/diff.md)) to `.gitignore`.

Next: [add seampact to an existing app](existing-project.md) or [work with an AI agent](ai-agents.md).
