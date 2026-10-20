# Config reference

Every key of `seampact.config.yaml`. Paths are relative to the config file. A key not listed here is refused with `config.schema`. For a task, start from [The config file](config-file.md).

## App config

| Key | Type | Default | Meaning |
|---|---|---|---|
| `outDir` | string | `__generated__` | The folder for all generated code. |
| `allowLocal` | boolean | `true` | `false` refuses `path` sources, for shared branches. `SEAMPACT_ALLOW_LOCAL=false` refuses them too. |
| `sources` | map | none | The contracts, by name. See [Sources](#sources). |
| `targets` | list | none | What to generate. See [Target entries](#target-entries). |
| `openapi` | `none` or map | a document per api of a server target | Where the OpenAPI documents go. See [OpenAPI](#openapi). |
| `checks` | map | see below | How `check` fails. |
| `diff` | map | see below | How `diff` fails. |

## Sources

One entry per name. Write the keys of one form.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | none | A local contract folder. It holds `workspace.yaml` or `api.yaml`. |
| `package` | string | none | A contract published as an npm package. Needs `version`. |
| `version` | string | none | The pinned version of `package`. |
| `release.url` | string | none | A contract published as a release asset. |
| `git.url`, `git.tag` | string | none | A contract in a git repository, at a tag. |
| `git.directory` | string | the repository root | The folder of the contract in the repository. |
| `integrity` | string | none | The `sha256-` hash of the bundle. For `package`, `release` and `git`. |

## Target entries

| Key | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | required | Names the entry. It is the folder under `outDir`. |
| `use` | string | required | The target package, such as `@seampact/codegen-ts`. |
| `api` | string | one of `api`, `apis` | The api to generate. `<source>/<api>` when two sources hold the name. |
| `apis` | list of strings | one of `api`, `apis` | Several apis, each under its own folder. |
| `document` | string | all operations | Generate only the operations of this document of the api. |
| `out` | string | the entry's `id` | The folder under `outDir`. |
| `link` | map | none | The entries this one builds on: `validators: validators`. |
| `options` | map | none | The target's own settings. |
| `operations.include`, `operations.exclude` | list of strings | all operations | Keep or drop operations by tag or operation id. |
| `artefacts` | map of booleans | the target's own | Switch each generated part on or off. `bootCheck` also takes `{ frameworkRoutes: false }`. `index: false` skips the api `index` module of a Node server target. |
| `artefacts.bootCheck.hooks` | `error`, `warn`, `off` | `error` | What a Node server does at boot when a hook the contract needs is not registered: refuse to start, log and start, or start silently. A route whose hook is missing answers 500 on every request, whatever the level; an output field right with a missing decider runs the handler first, then answers 500. A right claimed by two deciders always refuses to start. `bootCheck: false` does not change it. |
| `allowUntested` | list of strings | none | Accept a framework major that is not tested: `nestjs@13`. |
| `frameworkRoutes` | list | none | Server targets. Routes outside the contract that the boot check accepts: `path`, `reason`, optional `method`. |
| `frameworkDocs` | `keep` or `off` | `keep` | Server targets. `off` drops the framework's own document. |

`mount` and `access` are planned. They are refused with `config.key.waits`.

## OpenAPI

`openapi` maps an api name to a path, or to a map of options.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `path` | string | `openapi/<api>.yaml` | Where the document goes. |
| `extensions` | `all`, `none` or list | `all` | Which `x-seampact-` extensions it keeps. |
| `reasons` | `include` or `omit` | `include` | `omit` drops the reasons of safety exceptions, so a public document shows no internal rationale. |
| `inputSchemas` | `shared` or `strict` | `shared` | `strict` writes a second `<name>.input` schema that refuses unknown keys, for request bodies. |
| `servers` | list | none | OpenAPI servers: `url` and optional `description`. |

An api that declares `documents` maps each document id to a path or to these options. See [OpenAPI and docs](openapi-and-docs.md).

## Checks

| Key | Type | Default | Meaning |
|---|---|---|---|
| `checks.generated` | `error`, `warning`, `disabled` | `error` | Generated files that differ from the contract. |
| `checks.openapi` | `error`, `warning`, `disabled` | `error` | OpenAPI documents that differ. |
| `checks.matrix` | `error`, `warning` | `warning` | A framework version seampact has not tested. |

## Warnings

| Key | Type | Default | Meaning |
|---|---|---|---|
| `warnings.ignore` | list of strings | none | Generate warnings to silence, by form, such as `paging.sortKeys`. A warning is also silenced by its full code (`paging.sortKeys.handler`). The code of a warning is printed with it. It covers the warnings a target writes, not the compatibility warnings; an entry that matches no warning is ignored. |

## Diff

| Key | Type | Default | Meaning |
|---|---|---|---|
| `diff.gate` | `clients` or `both` | `clients` | Which breaking changes fail: those that break clients, or clients and servers. |
| `diff.exempt` | list of `experimental`, `sunsetPassed` | both | Breaking changes that do not fail: on experimental operations, or on operations whose sunset date has passed. |

## Root config

The root config of a [monorepo](monorepo.md) takes these keys.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `apps` | list of strings | required | The app folders. Each has its own config. |
| `sources` | map | none | Sources the apps share. Same forms as above. |
| `allowLocal` | boolean | `true` | Same as in an app. |
| `openapi` | map | none | Merged documents, by name. |
| `openapi.<name>.path` | string | required | Where the merged document goes. |
| `openapi.<name>.apps` | list of strings | every app | The apps it covers. |
| `openapi.<name>.prefix` | map | none | A prefix per api for its operation ids and schema names, when they would clash. |
| `openapi.<name>.extensions`, `reasons`, `inputSchemas`, `servers` | as above | as above | The same options as an app document. |
| `checks.openapi` | `error`, `warning`, `disabled` | `error` | Drift in a merged document. |

Errors: [Config errors](../troubleshooting/config.md).
