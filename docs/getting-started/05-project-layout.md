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

## Repository layouts

Layouts mix freely, and each app picks its own stack.

- **One monorepo** with services, frontends and contracts: a root config lists the apps, each reads its contract as a `path` source. See [monorepo](../configuration/monorepo.md).
- **Services in a monorepo, frontends apart:** the monorepo publishes bundles; each frontend repository pins one with a `package`, `git` or `release` source.
- **One repository per app:** the contracts live in a contract repository that publishes bundles, and each app pins the ones it uses. See [sharing contracts](../features/sharing-contracts.md).
- **A shared core contract:** pin it as a bundle (npm package, git tag, release URL, or Maven for the JVM plugins), or add it as a git submodule read as a `path` source. A `path` may point anywhere, inside the repository or not; it is a local source, so `allowLocal: false` refuses it.

Next: [add seampact to an existing app](04-existing-project.md) or [work with an AI agent](06-ai-agents.md).
