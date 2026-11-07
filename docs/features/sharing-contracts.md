# Sharing a contract between repositories

Use this page to share one contract with several repositories. The contract repository publishes a package (a bundle: the YAML sources and an integrity hash). Each app pins a version and its hash. `seampact check` fails if the pinned bundle was altered.

In the contract repository, `seampact bundle --tarball contract.tgz` writes the bundle and prints its integrity. The name and version come from the contract folder's `package.json`, or from `--name` and `--version` when it has none. Run `bundle` with the Node CLI or the compiler binary: see [commands per stack](commands-per-stack.md).

Pick how you publish the bundle. Each consumer reads it with the matching source in `sources`.

<details>
<summary>npm package</summary>

`seampact bundle --npm-package <dir>` writes an npm package. Publish `<dir>`, then pin it in each Node app with `package: "@acme/notes-contract"` and `version`. The npm CLI reads it; a Java, PHP or Python app uses another source.

</details>

<details>
<summary>Git tag</summary>

`seampact bundle --out <dir>` writes a plain folder. Commit it to a repository and tag it. Pin it with `git: { url, tag, directory }` and `integrity`. Every stack reads it.

</details>

<details>
<summary>Release asset</summary>

`seampact bundle --tarball contract.tgz` writes one file. Attach it to a release and pin it with `release: { url }` and `integrity`. Every stack reads it.

</details>

<details>
<summary>Maven artefact</summary>

Publish the bundle as a Maven artefact and pin it with `maven: <groupId>:<artifactId>:<version>` and `integrity`. Only the Gradle and Maven plugins read it: the npm CLI refuses it with `bundle.maven-jvm-only`.

</details>

Every key of a source: [the config reference](../configuration/reference.md#sources).

The pin goes in `sources`: see [the config file](../configuration/config-file.md).

## Repository layouts

Layouts mix freely, and each app picks its own stack.

- **One monorepo** with services, frontends and contracts: a root config lists the apps, each reads its contract as a `path` source. See [monorepo](../configuration/monorepo.md).
- **Services in a monorepo, frontends apart:** the monorepo publishes bundles; each frontend repository pins one with a `package`, `git` or `release` source.
- **One repository per app:** see below.
- **A shared core contract:** pin it as a bundle (npm package, git tag, release URL, or Maven for the JVM plugins), or add it as a git submodule read as a `path` source. A `path` may point anywhere; it is a local source, so `allowLocal: false` refuses it.

## One repository per app

**In the contract repository.** Give it a `seampact.config.yaml` with the contract as a `path` source and one target, so `diff` knows what to compile:

```yaml
sources:
  notes:
    path: ./contract
targets:
  - { id: types, use: "@seampact/codegen-ts", apis: [notes] }
```

To release, run `seampact bundle --npm-package dist`, publish `dist`, and note the integrity it prints. A git tag or a release asset works too.

In CI, compare each change with the last release. With `compat: { policy: additive-only }` under `api:`, a breaking change fails the step:

```sh
git checkout v1.2.0 && seampact compile --out baseline && git checkout -
seampact diff --against baseline
```

**In each service or frontend repository.** Install the package (`npm install @acme/notes-contract@1.2.0`) and pin it:

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

Run `seampact generate` and commit the result. In CI, `seampact check` fails when the installed bundle is not the one you pinned.

To move to a new release, install it, change `version` and `integrity`, run `generate` again and commit.

## A contract of your own, and one from another repository

One app can own a contract and use another team's, each in its own target entry:

```yaml
sources:
  orders:
    path: ./contract
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
targets:
  - { id: types, use: "@seampact/codegen-ts", apis: [orders, notes] }
  - { id: client, use: "@seampact/codegen-fetch", apis: [notes], link: { types: types } }
```

## Good to know

- To refuse local contract sources on shared branches, set `allowLocal: false` or `SEAMPACT_ALLOW_LOCAL=false` in CI.
- Line endings are stored as LF, so a Windows and a Linux checkout give the same bundle.

## Next

[Diff](diff.md), then [Check it in CI](check-in-ci.md).
