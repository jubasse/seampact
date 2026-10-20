# Sharing a contract between repositories

A contract repository publishes a bundle: the YAML sources, the compiled IR and an integrity hash, as an npm package, a release asset or a git tag. Each consumer pins a version and its hash in its `seampact.config.yaml`, generates the code it needs and commits the result. `seampact check` fails when the pinned bundle was altered, and your CI can refuse local contract sources on shared branches.
