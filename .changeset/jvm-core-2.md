---
---

Java builds can now read the app config from `seampact.config.yaml` or the build DSL, fetch pinned contract bundles from a release URL, a git tag or a Maven artefact (the new `maven` source), and write generated files safely into the output directory; the Node CLI refuses a `maven` source by name.
