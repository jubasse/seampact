---
---

FastAPI apps now serve their contract routes through `bind_<api>()`: the generated boundary checks each request, runs the access hooks with typed credentials, validates the typed input and checks the reply, and the boot check refuses by name a misplaced boundary, a missing hook or handler, an operation feature of a later release, and a FastAPI, Starlette or Pydantic version `generate` did not accept.
