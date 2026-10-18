# Orchestrator

For the lead session only: subagents never read this file. The lead reads it once per session, after `.work/HANDOFF.md` (which holds the state; this file holds the stable rules). The rules of each role are in `.claude/agents/seampact-<role>.md`; read the one you judge against before accepting a hand-back.

## Agents

| Task | Type | Model, effort |
|---|---|---|
| lane PR, review fixes, committed docs | `seampact-implementer` | Opus medium (Sonnet for small or mechanical lanes) |
| single review, lens review, synthesis | `seampact-reviewer` | one review per PR: Opus high for compiler and target code, Sonnet medium for docs; lens panel (Sonnet high) and synthesis (Opus high) only for an IR change |
| listed nits, rebase plus gate, regeneration | `seampact-mechanical` | Haiku (its default) |
| one-shot repo-wide script | `seampact-refactor` | Sonnet (its default) |
| `.work/` brief or decision synthesis | `seampact-writer` | Opus (its default), high for design |

- `general-purpose` only when a task needs a tool the types lack (WebFetch, an MCP server other than context7, the Agent tool); its prompt starts with "Read `.claude/agents/seampact-<role>.md` first"; note the case in the handoff.
- Prefer a fresh agent over resuming one for more than a few calls.
- Target PR size: about 1,500 changed lines.
- At most 4-5 agents at once; run them in the background; new or edited agent files load only after a session restart.

## Prompt

One line each, in this order: task and PR or lane; worktree, branch and tip, lane id, report or review output path (absolute, review files named `pr<n>.iter<k>[.<lens>].md`); inputs (review file or brief section, decision ids to grep, ADR or grammar section files) with "read only the cited ranges"; owned paths and lead grants; call cap (60, 100, 140); first step (rebase, known gate failure); trailer `Co-Authored-By: Claude <Model> 5.5 <noreply@anthropic.com>`; the gates to end with; the return (max lines: tip, gate result, per-finding status, items for the lead). Never repeat AGENTS.md or the role file.

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

- Rebase on develop, push (force with lease after a rebase, saying why), open the PR (title imperative under 70 characters, body why and behaviour, 3-6 bullets), review, post the "## Comment", wait for CI in the background (`gh pr checks <n> --watch`), squash-merge.
- After each merge, the next branch rebases and runs `pnpm vitest run packages/core/compiler/src/passes`: a stricter pass breaks other lanes' test contracts.
- After each merge, message the agents still working on other branches to rebase before their hand-back.
- `gh` often hits TLS timeouts: check the state before retrying.

## Paths

Handoff `.work/HANDOFF.md`; decisions `.work/decisions.md` (landed ones in `.work/archive/decisions-merged.md`); lane briefs `.work/plan/`; reports `.work/<lane>-report.md`; reviews `.favir/local/review/`; cost audit `.work/tools/audit.py <session-id>` and `.work/agent-cost-audit.md`, run at each wave end.
