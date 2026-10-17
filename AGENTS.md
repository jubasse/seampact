# Agent conventions

Repository conventions every agent follows. Your task prompt adds the task, the files you own and the report path.

## Before you start

- Read `docs/agents/cartography.md` before exploring: packages, roles, compiler stages and one line per source directory.
- Product decisions are in `docs/decisions.md` (cited as `A<n>`), design in `docs/adr/`.
- Read a decision by grepping its anchor (`rg -n 'id="a44"' docs/decisions.md`), then the lines after it; never read `docs/decisions.md` whole.
- Read the grammar and the IR by section file: `docs/grammar/` (ADR 0002, one `<NN>-<slug>.md` per section NN, plus `example.md`) and `docs/ir/` (ADR 0004, same naming). The ADR keeps the summary and a section-to-file table.
- Search first (`rg`), then read the needed range; never re-read a file already read in the session.
- Run `pnpm install --frozen-lockfile` first.

## Git

- Git flow ([A44](docs/decisions.md#a44)): `feat/<feature>` from develop, squash-merged into develop; `release/<version>` and `hotfix/<version>` as A44 and `CONTRIBUTING.md` describe.
- Never commit on develop or main, never push, never open a PR, never use `--no-verify`. The lead pushes and merges.
- Commit each green step on your branch. Message: one imperative English sentence ending with a period, a body only for a reason, then the two trailer lines your task prompt gives (`Co-Authored-By:` and `Claude-Session:`).

## Gates

- During work: the affected tests (`pnpm vitest run <paths>`), `pnpm typecheck`, `pnpm lint`.
- Once at the end of a PR: `pnpm install --frozen-lockfile && pnpm gate && node scripts/checklist/cli.ts check && node scripts/cartography/cli.ts --check`, and a clean tree.
- A stale map: run `node scripts/cartography/cli.ts --write` and commit `docs/agents/cartography.md`. CI checks it on every PR. The pre-push hook regenerates the map and refuses the push while it is uncommitted, but only on the current checkout: it skips with a message when a pushed commit is not `HEAD` or the tree has uncommitted changes, so CI is the guarantee.
- Stop on a classifier refusal and report it; never work around it.

## Files

- Edit only the files your task owns. A needed change elsewhere goes under "For the lead" in your report.
- Shared files change only in lead or seam PRs: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`, the `exports` of `packages/core/spec`, `packages/core/spec/src/ir/**` and `packages/core/spec/schemas/ir/**`, the derivation table `packages/core/compiler/src/derivations/table.ts`, `docs/conformance/checklist.yaml`, `README.md`, the agent types in `.claude/agents/`, this file.
- A lane adds its CI jobs in its own `.github/workflows/<lane-id>.yml`.
- The IR is change-controlled (ADR 0005): an IR change is asked of the lead, never worked around.
- Every new source directory gets a header the cartography reads: a `//` comment at the top of its `index.ts` whose first sentence says what the directory holds, or a one-line `README.md` when it has no `index.ts`.

## Proofs

- Never edit `docs/conformance/checklist.yaml`. Record the fixtures and tests that prove a checklist item in `docs/conformance/proofs/<lane-id>.yaml`; the checklist script merges them.

## Reports

- Your report goes to `.work/<lane-id>-report.md` of the primary checkout (not your worktree), reviews to `.favir/local/review/`; both are git-ignored and never committed.
- Keep the report current: resume state (branch, tip, done, next), then "For the lead".

## Long tasks

- Call cap: the task prompt sets it from what the task must load first: light (report and a few files) 60, medium (review file, several passes, ADR sections) 100, heavy (cross-language parity, generators, wide spec) 140; without one, 100. A cap, not a target.
- Checkpoint at about 70% of the cap (40, 70 or 100 calls): relay if more work remains than a fresh setup costs (about 15 calls light, 30 medium, 40 heavy), otherwise finish within the cap. At the cap with work left, relay anyway.
- To relay: stop at the next green commit, update the resume state (files understood, files left to edit) and hand back "continue". The lead starts a fresh agent.
- Resume rule: on a resumed task, read the report's resume state, run `git diff --stat` against the base, and read only the files you edit.

## Before hand-back

Run this on your own diff, before the final gates:

- No silent drop or fallback: every input is used, refused with a diagnostic, or listed as out of scope.
- Every value a pass stores is copied (`pipelineCopy`), never kept by reference.
- Every new branch has a test that reaches it; a bug fix has a test that failed before.
- No copied helper: search for an existing one first, else one shared helper.
- Rule ids, messages and fixes are consistent across code, tests and docs.
- No committed comment, doc or test string points into `.work/` or another git-ignored path (the agent types in `.claude/agents/` excepted: they name the lead's working files).
- Proofs (`docs/conformance/proofs/<lane-id>.yaml`) and the changeset are updated.
- Every new source directory has its header; the cartography map is current.
- `git diff --stat` lists only files your task owns.
- Fix what the list finds, then hand back; do not hand back a known failure.

## Shell output

- RTK is opt-in and usually the right choice for output past about ten lines you do not filter yourself (`rtk err <cmd>`, `rtk test <cmd>`, `rtk read -m 40 <file>`). Stay raw when you filter the output yourself (`| grep`, `| head`), when it is a few lines, or when exactness matters: complete searches, diffs and logs under review, JSON, env values, debugging, security. Never pipe rtk output into another tool.

## Code style

- Airy code, blank lines between steps; max 3-4 nesting levels: early return, else extract a function.
- Long precise names (`pendingInvoiceTotal`, not `data`); function names make comments unnecessary.
- Comments: short, plain, only for non-obvious logic or reasons. No emoji or symbols.
- Match surrounding style; minimal diffs; no speculative abstraction, dead or commented-out code.
- One concept per file: its types, interfaces, enums, classes and functions together; one shared helper, never a copy.
- No swallowed errors (empty catch, silent fallback): say what failed and the fix.
- No `any` or forced casts; named constants, no magic values or boolean flag params.
- Bug fix = test failing before; test behaviour, not implementation.
- When you modify a file, apply these conventions to the code you touch.
