---
---

The FastAPI and DRF targets write one shared `contract` module the runtime reads per operation, FastAPI's operation types move to the `operations` module, `on_unexpected_error` takes a `seampact.hooks.UnexpectedErrorListener`, and `seampact generate` refuses `frameworkDocs: off` by name on a Python target that cannot switch its framework's own document off.
