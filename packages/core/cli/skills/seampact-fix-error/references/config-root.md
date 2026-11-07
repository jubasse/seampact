<!-- Generated from docs/troubleshooting/config-root.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Monorepo and OpenAPI errors

Page: https://jubasse.github.io/seampact/troubleshooting/config-root/

Codes for the root config and for the `openapi` key.

## Monorepo

| Code | Cause and fix |
|---|---|
| `config.root.not-an-app` | The command runs on one app, and the config is the root. Run it in the app folder, or pass the app's config with `--config`. |
| `config.root.app-key` | The root config takes only keys the apps share. Move `targets` and `outDir` into the app's own config. |
| `config.apps.no-config` | A folder in `apps` has no `seampact.config.yaml`. Create it or fix the folder. |
| `config.apps.outside` | An app folder is not below the root, or is not relative to the root config. Move it below the root and write it relative. |
| `config.apps.duplicate` | One folder is listed twice in `apps`. List each app once. |
| `config.app.unlisted` | The app uses a source from the root, but the root's `apps` does not list it. Add the folder to `apps`. |

## OpenAPI documents

| Code | Cause and fix |
|---|---|
| `config.openapi.unknown-api` | `openapi` names an api no source holds. Use a name from `workspace.yaml`. |
| `config.openapi.ambiguous-api` | Two sources hold that api. Rename one of the apis. |
| `config.openapi.document-needed` | The api declares several documents. Map each one to a path. |
| `config.openapi.no-documents` | The api declares no `documents`. Give one path, not a mapping. |
| `config.openapi.unknown-document` | `openapi` maps a document the api does not declare. Map only the documents the api declares. |
| `config.openapi.path-conflict` | Two documents have the same path. Give each its own. |
| `config.openapi.inside-output` | A document is inside a generated folder. Write it outside, as the default `openapi/` does. |
| `config.openapi.unknown-app` | A merged document names an app that `apps` does not list. Add the app to `apps`, or fix the name. |
| `openapi.document.edited`, `openapi.document.not-generated` | A file at the document path is not seampact's. Delete it, move it, or give the document another path. |

See [Monorepo](https://jubasse.github.io/seampact/configuration/monorepo/) and [OpenAPI and docs](https://jubasse.github.io/seampact/configuration/openapi-and-docs/).
