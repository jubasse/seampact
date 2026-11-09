### What the generated code depends on

At run time:

- Python 3.12 or later;
- `fastapi` from 0.162, with the Starlette it brings, and `pydantic` 2.9 or later;
- `seampact-hooks`, and `seampact-fastapi` with `seampact-codegen`, whose runtime the code imports.

The boundary runtime is imported, not copied (ADR 0025): the framework-neutral part from `seampact.codegen.runtime` and `seampact.codegen.runtime.pydantic`, shared with Ninja; the FastAPI part (the middleware, the dependencies, `bind_<api>()`'s registration, the exception map, the boot check) from `seampact.fastapi.runtime`. Generated code imports no other seampact package and no validation library beyond Pydantic. It never imports `seampact.signed_webhooks`: the app's authenticate hook calls it.

The generator's code sits in production `site-packages`, its dependencies behind the `generate` extra, as ADR 0025 accepted for PHP. Generated files print through the core's line printer (ADR 0015) and pass `ruff check`, `ruff format --check`, `mypy --strict` with the Pydantic plugin, and `pyright` strict, on Python 3.12 and the latest.
