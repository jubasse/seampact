# Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in its `seampact.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.

In the contract repository, `npx seampact bundle --tarball contract.tgz` writes the bundle and prints its integrity. `--npm-package <dir>` writes an npm package to publish, and `--out <dir>` writes a plain folder. The name and version come from the contract folder's `package.json`, or from `--name` and `--version`.

Line endings are stored as LF, so a Windows and a Linux checkout give the same bundle.

The pin goes in `sources`: see [the config file](../configuration/config-file.md).

## One repository per app

**In the contract repository.** Give it a `seampact.config.yaml` with the contract as a `path` source and one target, so `diff` knows what to compile:

```yaml
sources:
  notes:
    path: ./contract
targets:
  - { id: types, use: "@seampact/codegen-ts", apis: [notes] }
```

To release, run `npx seampact bundle --npm-package dist`, publish `dist`, and note the integrity it prints. A git tag or a release asset works too.

In CI, compare each change with the last release. With `compat: { policy: additive-only }` under `api:`, a breaking change fails the step:

```sh
git checkout v1.2.0 && npx seampact compile --out baseline && git checkout -
npx seampact diff --against baseline
```

**In each service or frontend repository.** Install the package (`npm install @acme/notes-contract@1.2.0`) and pin it:

```yaml
sources:
  notes:
    package: "@acme/notes-contract"
    version: 1.2.0
    integrity: sha256-...
```

Run `npx seampact generate` and commit the result. In CI, `npx seampact check` fails when the installed bundle is not the one you pinned.

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
