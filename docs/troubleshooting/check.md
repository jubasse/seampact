# Check errors

`seampact check` and `seampact generate` fail with these codes. See [Set the levels](../features/check-in-ci.md#set-the-levels).

| Code | Cause and fix |
|---|---|
| `check.generated.drift` | The generated files differ from the committed ones, or one was edited by hand. Run `seampact generate` and commit the result; for an edited file, move your code out and delete the file first. To relax it, set `checks.generated` to `warning` or `disabled`. |
| `check.openapi.drift` | Run `seampact generate` and commit the documents. Or set `checks.openapi` to `warning` or `disabled`. |
| `writer.file.edited` | `generate` will not overwrite a file edited by hand. Delete the file and generate, or run `seampact generate --force` to overwrite it. |
| `writer.file.not-generated` | A file in the output folder is not seampact's, or a name changed only by letter case since the last run (`Tasks.ts` to `tasks.ts`) on a case-insensitive disk. Move the file out, or delete the old file the message names, then run `generate`. |
| `writer.manifest.other-owner` | Two entries write to one folder. Give each its own `out`. |
| `writer.manifest.invalid`, `writer.manifest.not-regular` | The manifest in the output folder is damaged. Delete the generated files of that entry and its manifest, then run `generate`. |
| `file.path.invalid`, `file.extension.unsupported`, `file.php.open-tag`, `file.header.unsafe` | The target generated a file the writer refuses. For two names that differ only by case (`Tasks.ts`, `tasks.ts`; the second would overwrite the first on a case-insensitive disk), rename one in the contract. Otherwise update the target package, or report it to its maintainers. |
| `writer.path.outside` | A symbolic link in the output folder leads out of it. Replace it with a plain folder. |

You see `check: the generated files and documents match the committed ones.` when nothing drifted.
