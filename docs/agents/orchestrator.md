# Orchestrator

For the lead session only: subagents never read this file. The lead reads it once per session, after `.work/HANDOFF.md` (which holds the state; this file holds the stable rules). The rules of each role are in `.claude/agents/seampact-<role>.md`; read the one you judge against before accepting a hand-back.

## Agents

Spawn and message agents as the global AGENTS.md "Sub-agents" table says (Herdr or the Agent tool); the table below gives each task's type, model and effort.

| Task | Type | Model, effort |
|---|---|---|
| lane PR, review fixes, committed docs | `seampact-implementer` | Sonnet medium; Opus medium only for shared runtime code |
| single review, lens review, synthesis | `seampact-reviewer` | one review per PR: Sonnet medium; Opus high only for a freeze (ADR, IR, format) or shared runtime code; lens panel (Sonnet high) and synthesis (Opus high) only for an IR change |
| listed nits, rebase plus gate, regeneration | `seampact-mechanical` | Haiku (its default) |
| one-shot repo-wide script | `seampact-refactor` | Sonnet (its default) |
| `.work/` brief or decision synthesis | `seampact-writer` | Opus (its default), high for design |

- `general-purpose` only when a task needs a tool the types lack (WebFetch, an MCP server other than context7, the Agent tool); its prompt starts with "Read `.claude/agents/seampact-<role>.md` first"; note the case in the handoff.
- The `seampact-writer` type has no shell: an audit or brief that must read develop runs as `seampact-reviewer` in a worktree detached at `origin/develop` (the main worktree stays where it is).
- Follow-ups on a branch (a CI failure, review fixes, a rebase) go to the agent that wrote it (message the agent); a fresh agent only once that agent is near its call cap.
- Target PR size (A47): one deliverable, about 3,000 to 4,000 hand-written lines; seams stay small and land first. Past an agent's call cap, a fresh agent continues on the same branch from the report's resume state; the PR opens once the deliverable is done.
- Agent count follows the remaining work, at most 10 at once, never raised back when fewer lanes are open; run them in the background; new or edited agent files load only after a session restart.

## Rust port

- Grid: Sonnet medium for port lanes, each brief listing the TypeScript test cases to port; Sonnet high for derive and the loader; Opus high for design notes, seams (IR and authoring types, diagnostic type, writer) and freeze reviews. The lead runs Sonnet medium during port waves and Opus at freezes.
- One agent per 500-1,000 TypeScript lines, from a complete brief (template in the `seampact-rust-port-ts` skill).
- For lane PRs merged into the port branch `feat/rust-core`: one review per layer, not per PR; every PR to develop keeps its fresh-agent review. The mechanical checks (`clippy::indexing_slicing`, the trace check, cargo deny and machete) carry the rest.

## Economy

- Facts before critiques: a design rests on a spike or POC run on the real targets before any review round; no opinion round on an unverified design.
- Review stopping rule: stop after a round with no blocker whose fixes are text only; the lead checks those fixes, no new round.
- CI is the gate: agents run the local gate of AGENTS.md "Gates" (touched tests and typecheck); reviewers skip what CI checks (format, lint, types, checklist, cartography, the matrix) and judge behaviour.
- The lead pushes at the first green commit, so CI runs while the work or the review goes on.
- Reports and review files: grep the section or finding needed, never read them whole.
- Fresh session per phase: at a phase boundary, update the handoff, give the user a resume prompt, then the next phase starts in a new session.

## Prompt

One line each, in this order: task and PR or lane; worktree, branch and tip, lane id, report or review output path (absolute, review files named `pr<n>.iter<k>[.<lens>].md`); inputs (review file or brief section, decision ids to grep, ADR or grammar section files) with "read only the cited ranges"; owned paths and lead grants; call cap (60, 100, 140); first step (rebase, known gate failure); trailer `Co-Authored-By: Claude <Model> 5.5 <noreply@anthropic.com>`; the gates to end with; the return (max lines: tip, gate result, per-finding status, items for the lead). Never repeat AGENTS.md or the role file.

A docs prompt also states the audience (AI agents and mid-to-advanced developers: light on jargon, code that speaks for itself, short sentences) and that no information is lost: move or rewrite, never drop, and a moved fact leaves a link at its old place.

## Reviews

- Every PR gets a fresh-agent review comment before merge; a merge whose last review is REQUEST_CHANGES is refused.
- Single review: one `seampact-reviewer`, asked only for a wrong IR or generated code, a silent drop, a valid contract refused or an untested stable brick (A47). Full review (an IR change only): three lens reviewers (correctness, security, cto), each given only its lens's files from `git diff --stat`, writing `pr<n>.iter<k>.<lens>.md`, then one synthesis reviewer writing `pr<n>.iter<k>.md`; the lead checks that every lens file exists before starting the synthesis.
- REQUEST_CHANGES: settle the open readings as decisions, post the comment, then a fix agent with the finding list; no re-review: the lead checks each fix by the test that failed before, then merges. APPROVE_WITH_NITS: mechanical applies the nits, the lead checks that diff and merges, no new round; an APPROVE_WITH_NITS whose majors fail closed may merge with those majors listed for the lane's next PR.

## Accepting a hand-back

- Complete lane PR: end-of-PR gate green, tests as A47 states, one changeset sentence, cartography current, diff limited to owned files.
- Author check keywords: no silent drop, `pipelineCopy`, stable bricks tested (A47), no copied helper, consistent rule ids, no `LD-<n>` or `.work/` in committed text.
- End-of-PR gate: as `seampact-implementer.md` "Before hand-back" states it.
- Review: accepted only once its review file exists at the path the prompt gave.

## Merge loop

- Rebase on develop, push (force with lease after a rebase, saying why), open the PR (title imperative under 70 characters, body why and behaviour, 3-6 bullets), review, post the "## Comment", wait for CI in the background (`.work/tools/wait-ci.sh <n>`, then no pending check-run on either page), squash-merge.
- After each merge, the next branch rebases and runs `pnpm vitest run packages/core/compiler/src/passes`: a stricter pass breaks other lanes' test contracts.
- After each merge, message the agents still working on other branches to rebase before their hand-back.
- `gh` often hits TLS timeouts: check the state before retrying.
- develop requires a branch up to date with it (strict required checks; GitHub offers no merge queue on a user-owned repository): a lone PR merges with `.work/tools/merge-seq.sh <pr>...` (update the branch, wait for the fast tier, check no check-run is pending, squash-merge, stop at the first failure). Ready PRs land together as an integration batch: one integration branch from develop, one commit per PR ("<title> (#n)"), CI once, a merge commit, the batched PRs closed with a pointer; run at least one consumer per family before the push. The full tier runs on each push to develop; a failure there is fixed forward (`ci-watch` opens an issue). Chain cleanup (worktree remove, branch delete, required checks) after it with `&&` only, never `;`.
- A job that fails on a registry refusal (Maven Central 429, 403 or a missing artifact that exists) is rerun once with `gh run rerun <run> --failed` before it is read as a failure.
- GitHub sometimes abandons jobs or fails a workflow at startup with no job, which then shows nowhere on the pull request: rerun once, and before merging check each required context by name (`gh api .../required_status_checks` against `gh pr checks`).
- Dependabot: merge a green grouped PR; a security PR on a floor requirement file is merged only while the new version stays inside the floor the compatibility matrix declares, otherwise closed and its alert dismissed as test-only by the user.
- Actions cache (10 GB repository limit): pull requests only restore; pushes, the nightly and a manual run save. Check the split with `gh api repos/jubasse/seampact/actions/cache/usage` and the caches listing after a CI change.

## Paths

Handoff `.work/HANDOFF.md`; decisions `.work/decisions.md` (landed ones in `.work/archive/decisions-merged.md`); lane briefs `.work/plan/`; reports `.work/<lane>-report.md`; reviews `.favir/local/review/`; cost audit `.work/tools/audit.py <session-id>` and `.work/agent-cost-audit.md`, run at each wave end.

Python: the uv workspace is `python/` (lock `python/uv.lock`); every Python agent prompt sets `UV_PYTHON_INSTALL_BIN=0`, so uv links no `python` into `~/.local/bin`, and its worktree runs `uv sync --locked --all-packages` from `python/`. The consumers are `scripts/consumers/targets/fastapi/` and `drf/`; the workflows are `p7-python-core.yml`, `p7-fastapi.yml` and `p7-drf.yml`.
