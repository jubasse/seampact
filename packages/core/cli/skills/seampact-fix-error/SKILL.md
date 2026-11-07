---
name: seampact-fix-error
description: Fix a seampact error or a failed seampact command. Use when output shows a seampact error code such as `check.generated.drift`, `paging.sort.style.unsupported` or `seampact/tree/...`, a message that ends in `Fix:`, or when `seampact lint`, `generate` or `check` exits non-zero, even if the user does not name seampact. Not for writing handlers (seampact-implement-handler) or planned contract edits (seampact-change-contract).
---

# Fix a seampact error

Every error starts with a code and ends with `Fix:`. Read the message and its `Fix:` first.

1. Copy the code. Search for it in the `references/` folder beside this SKILL.md, from the project root: `grep -rn "<code>" .agents/skills/seampact-fix-error/references/` (or the skills folder your tool uses). One table row gives the cause and the fix for your stack. The row is a table cell, so read the whole line.
2. Sort the fix into one of three classes before you act.
   - Class A: the fix edits only YAML syntax, a typo in the config, or your own handler code. Apply it.
   - Class B: the fix removes an operation, a member, a header or an option, or changes what the API answers. Stop and ask the user: that changes what the API does, and a header or member you drop may carry real behavior, such as a version token.
   - Class C: the message says the form is not generated yet, or the code ends in `.unsupported`. This is a known limit of the target. Do not hand-edit generated code, and do not delete the operation on your own. Tell the user the options: change the contract form, pick another server target, or wait for support. Ask which.
3. Run again the command that failed. The same code again means the fix was not applied; a new code is the next error, so repeat from step 1.
4. When the command passes, run `lint`, `generate`, then `check`. Command lines for this stack are in AGENTS.md.

## Common cases

- `check.generated.drift`: the generated files differ from the contract. Run `generate` and keep the result. For a file someone edited by hand, move that code out of the generated folder first.
- A code ending in `.unsupported`: class C.
- A contract error `seampact/...`: it names the file, the line and the column. Edit the contract there and run `lint` again.
- A message with no code that starts `seampact: the api '<id>' cannot start`: read `references/boot.md`.

## Never

- Pass `--force` to `generate` unless the user asks: it overwrites hand edits.
- Edit the generated folder to make a check pass.
- Add `operations` filters, remove options or turn a check off just to silence an error without asking.
