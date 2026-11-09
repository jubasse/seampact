### Delivery

| PR | Delivers |
|---|---|
| drf-1 | `python/django` emitters (URLconf, settings, app config) and `python/drf`: the generator, dataclass inputs, serializers, `APIView` declarations, exceptions; a golden under ruff and `mypy --strict` with the stubs, on Django 5.2 and 6.x |
| drf-2 | the boundary middleware (sync and async), the `APIView` steps 2 to 8, the exception map and the handler wrappers, the system check, the boot check, `seampact_generate` and `seampact_check`; the sample app, the `default`, `hand-written` and `boot` profiles, the e2e job of `p7-drf.yml` |
| drf-3 | paging, idempotency, throttle beside DRF's throttles, cache headers, the signed raw body, deadlines, relays, redaction; the suite over every operation of both apis with nothing refused, and `test_redaction.py` |
| drf-4 | DRF authentication, permission and throttle classes per access kind, the role map of DRF's exceptions, session and CSRF beside the boundary, absolute URLs, CORS preflights left to the app; the suite's security rows and a token-auth row in the consumer. Principal bindings stay refused by name, as on PHP, until after 1.0 |
| ninja-1 | `python/ninja`: the generator on the shared Pydantic emitter, `Router` declarations, views, `bind_<api>()`; a golden under ruff, `mypy --strict` and `pyright` strict |
| ninja-2 | the Ninja placement on `seampact-django`, the `on_exception` wrapper, sync and async views; the sample app, every profile, `p7-ninja.yml` |
