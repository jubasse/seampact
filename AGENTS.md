# Agent conventions

Repository conventions every agent follows. Your task prompt adds the task, the files you own and the report path.

## Before you start

- Read `docs/agents/cartography.md` before exploring: packages, roles, compiler stages and one line per source directory.
- Product decisions are in `docs/decisions.md` (cited as `A<n>`), design in `docs/adr/`.
- Run `pnpm install --frozen-lockfile` first.

## Git

- Git flow ([A44](docs/decisions.md#a44)): `feat/<feature>` from develop, squash-merged into develop; `release/<version>` and `hotfix/<version>` as A44 and `CONTRIBUTING.md` describe.
- Never commit on develop or main, never push, never open a PR, never use `--no-verify`. The lead pushes and merges.
- Commit each green step on your branch. Message: one imperative English sentence ending with a period, a body only for a reason, then the two trailer lines your task prompt gives (`Co-Authored-By:` and `Claude-Session:`).

## Gates

- During work: the affected tests (`pnpm vitest run <paths>`), `pnpm typecheck`, `pnpm lint`.
- Once at the end of a PR: `pnpm install --frozen-lockfile && pnpm gate && node scripts/checklist/cli.ts check && node scripts/cartography/cli.ts --check`, and a clean tree.
- A stale map: run `node scripts/cartography/cli.ts --write` and commit `docs/agents/cartography.md`. CI checks it on every PR. The pre-push hook also runs `--check`, but only on the current checkout: it skips with a message when a pushed commit is not `HEAD` or the tree has uncommitted changes, so CI is the guarantee.
- Stop on a classifier refusal and report it; never work around it.

## Files

- Edit only the files your task owns. A needed change elsewhere goes under "For the lead" in your report.
- Shared files change only in lead or seam PRs: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`, the `exports` of `packages/spec`, `packages/spec/src/ir/**` and `packages/spec/schemas/ir/**`, the derivation table `packages/compiler/src/derivations/table.ts`, `docs/conformance/checklist.yaml`, `README.md`, this file.
- A lane adds its CI jobs in its own `.github/workflows/<lane-id>.yml`.
- The IR is change-controlled (ADR 0005): an IR change is asked of the lead, never worked around.
- Every new source directory gets a header the cartography reads: a `//` comment at the top of its `index.ts` whose first sentence says what the directory holds, or a one-line `README.md` when it has no `index.ts`.

## Proofs

- Never edit `docs/conformance/checklist.yaml`. Record the fixtures and tests that prove a checklist item in `docs/conformance/proofs/<lane-id>.yaml`; the checklist script merges them.

## Reports

- Your report goes to `.work/<lane-id>-report.md` of the primary checkout (not your worktree), reviews to `.favir/local/review/`; both are git-ignored and never committed.
- Keep the report current: resume state (branch, tip, done, next), then "For the lead".

## Shell output

- RTK is opt-in and usually the right choice for output past about ten lines you do not filter yourself (`rtk err <cmd>`, `rtk test <cmd>`, `rtk read -m 40 <file>`). Stay raw when exactness matters. Your task prompt carries the full rules.

## Code style

- Airy code, blank lines between steps; max 3-4 nesting levels: early return, else extract a function.
- Long precise names (`pendingInvoiceTotal`, not `data`); function names make comments unnecessary.
- Comments: short, plain, only for non-obvious logic or reasons. No emoji or symbols.
- Match surrounding style; minimal diffs; no speculative abstraction, dead or commented-out code.
- No swallowed errors (empty catch, silent fallback): say what failed and the fix.
- No `any` or forced casts; named constants, no magic values or boolean flag params.
- Bug fix = test failing before; test behaviour, not implementation.
- When you modify a file, apply these conventions to the code you touch.
