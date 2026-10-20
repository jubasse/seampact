# Check errors

`seampact check` and `seampact generate` fail with these codes. See [Checks](../configuration/checks.md).

| You see | Do |
|---|---|
| `check.generated.drift ... differ from the committed files` | Run `seampact generate` and commit the result. Or set `checks.generated` to `warning` or `disabled`. |
| `check.generated.drift ... was edited by hand` | Move your code out of the generated folder, delete the edited file, run `generate`. |
| `check.openapi.drift` | Run `seampact generate` and commit the documents. Or set `checks.openapi` to `warning` or `disabled`. |
| `writer.file.edited` | Same as an edit by hand: `generate` will not overwrite it. Delete the file, then generate, or run `seampact generate --force` to overwrite it (a stale edited file the run no longer produces is removed). |
| `writer.file.not-generated` | A file in the output folder is not seampact's. Move it out. |
| `writer.manifest.other-owner` | Two entries write to one folder. Give each its own `out`. |
| `writer.manifest.invalid`, `writer.manifest.not-regular` | The manifest in the output folder is damaged. Delete the generated files of that entry and its manifest, then run `generate`. |
| `writer.path.outside` | A symbolic link in the output folder leads out of it. Replace it with a plain folder. |

You see `check: the generated files and documents match the committed ones.` when nothing drifted.
