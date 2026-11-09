### Delivery

| PR | Delivers |
|---|---|
| py-core-5 | `python/codegen`: the neutral plan, names, layout, refusals, the Pydantic emitter, route table data and route helpers; the shared runtime's step 1 decoding, raw-target match, replies, verdict and version |
| fastapi-1 | `python/fastapi`: the generator in the entry point group, the options, models, handler protocols, router declarations, exceptions per error, `bind_<api>()`; a golden for the reference contract under `ruff`, `mypy --strict` and `pyright` strict on Python 3.12 and the latest |
| fastapi-2 | the boundary (steps 1 and 10), the access and input dependencies (steps 2 to 8), the exception map, the lifespan boot check and its first-request fallback, the 500 on a missing hook, scopes in the request scope; the sample app, the `default`, `hand-written` and `boot` profiles, the e2e job of `p7-fastapi.yml` |
| fastapi-3 | paging, idempotency, throttle, cache headers, field rights, version tokens, deadline headers, the signed raw body, redaction; the suite over every operation of the tasks api and `test_redaction.py` |
| fastapi-4 | absolute URLs, relays with the tasksService api; authenticate hooks on FastAPI `Security` schemes; CORS and docs routes beside the boundary |
