# Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in its `seampact.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.

In the contract repository, `npx seampact bundle --tarball contract.tgz` writes the bundle and prints its integrity. `--npm-package <dir>` writes an npm package to publish, and `--out <dir>` writes a plain folder. The name and version come from the contract folder's `package.json`, or from `--name` and `--version`.

Line endings are stored as LF, so a Windows and a Linux checkout give the same bundle.

The pin goes in `sources`: see [the config file](../configuration/config-file.md).
