### What the generated code depends on

At run time: Python 3.12 or later; Django 5.2 or 6.x; DRF 3.18 for DRF; Ninja 1.5.3 or later and Pydantic for Ninja; `seampact-hooks`, `seampact-codegen`, `seampact-django` and the target's distribution. The boundary runtime is imported, not copied (ADR 0025). Generated files pass `ruff check`, `ruff format --check` and `mypy --strict` with `django-stubs` (and `djangorestframework-stubs` on DRF), on Python 3.12 and the latest, and Django 5.2 and 6.x; the Ninja golden also passes `pyright` strict.
