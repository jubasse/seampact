# Agent conventions

Repository conventions every agent follows. Your task prompt adds the task, the files you own and the report path. The rules of one role (implementer, reviewer, mechanical, refactor, writer) live in `.claude/agents/seampact-<role>.md`; a general-purpose agent that takes a role reads that file first.

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
- Commit each green step on your branch. Message: one imperative English sentence ending with a period, a body only for a reason, then the trailer lines your task prompt gives.

## Gates

- During work: the affected tests (`pnpm vitest run <paths>`), `pnpm typecheck`, `pnpm lint`.
- A test failure is a flake only once that test passes alone (name it in the hand-back); otherwise it is a failure.
- Stop on a classifier refusal and report it; never work around it.

## Files

- Edit only the files your task owns. A needed change elsewhere goes under "For the lead" in your report.
- Shared files change only in lead or seam PRs: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`, the `exports` of `packages/core/spec`, `packages/core/spec/src/ir/**` and `packages/core/spec/schemas/ir/**`, the derivation table `packages/core/compiler/src/derivations/table.ts`, `docs/conformance/checklist.yaml`, `README.md`, the agent types in `.claude/agents/`, `docs/agents/orchestrator.md`, this file.
- A lane adds its CI jobs in its own `.github/workflows/<lane-id>.yml`.
- The IR is change-controlled (ADR 0005): an IR change is asked of the lead, never worked around.
- No committed comment, doc or test string points into `.work/` or another git-ignored path, and none cites a lead decision id (`LD-<n>`); `.claude/agents/` and `docs/agents/orchestrator.md` are the exception, since they name the lead's working files.

## Long tasks

- Call cap: the task prompt sets it from what the task must load first: light (report and a few files) 60, medium (review file, several passes, ADR sections) 100, heavy (cross-language parity, generators, wide spec) 140; without one, 100. A cap, not a target.
- Checkpoint at about 70% of the cap (40, 70 or 100 calls): relay if more work remains than a fresh setup costs (about 15 calls light, 30 medium, 40 heavy), otherwise finish within the cap. At the cap with work left, relay anyway.
- To relay: stop at the next green commit, update the resume state of your report or review file (files understood, files left to edit) and hand back "continue". The lead starts a fresh agent.
- Resumed task: read that resume state, run `git diff --stat` against the base, and read only the files you edit or review.

## Hand-back

- Each "done" or "fixed" you report rests on a command you ran in this session.
- Hand back the lines the prompt asks for; details go to your report or review file.

## Shell output

- Batch independent reads, searches and checks in one message (read the 3-5 files a step needs at once), chain shell steps with `&&`, and print only what you will use.
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
