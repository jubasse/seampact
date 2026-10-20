# Monorepo and OpenAPI errors

Codes for the root config and for the `openapi` key.

## Monorepo

| You see | Do |
|---|---|
| `config.root.not-an-app` | The command runs on one app. Run it in the app folder, or pass the app's config with `--config`. |
| `config.root.app-key` | The root config takes only keys the apps share. Move `targets` and `outDir` into the app's own config. |
| `config.apps.no-config` | A folder in `apps` has no `seampact.config.yaml`. Create it or fix the folder. |
| `config.apps.outside` | An app folder must be below the root, relative to the root config. |
| `config.apps.duplicate` | List each app once. |
| `config.app.unlisted` | The app uses a source from the root, but the root's `apps` does not list it. Add the folder to `apps`. |

## OpenAPI documents

| You see | Do |
|---|---|
| `config.openapi.unknown-api` | `openapi` names an api no source holds. Use a name from `workspace.yaml`. |
| `config.openapi.ambiguous-api` | Two sources hold that api. Rename one of the apis. |
| `config.openapi.document-needed` | The api declares several documents. Map each one to a path. |
| `config.openapi.no-documents` | The api declares no `documents`. Give one path, not a mapping. |
| `config.openapi.unknown-document` | Map only the documents the api declares. |
| `config.openapi.path-conflict` | Two documents have the same path. Give each its own. |
| `config.openapi.inside-output` | A document is inside a generated folder. Write it outside, as the default `openapi/` does. |
| `config.openapi.unknown-app` | A merged document names an app that `apps` does not list. |
| `openapi.document.edited`, `openapi.document.not-generated` | A file at the document path is not seampact's. Delete it, move it, or give the document another path. |

See [Monorepo](../configuration/monorepo.md) and [OpenAPI and docs](../configuration/openapi-and-docs.md).
