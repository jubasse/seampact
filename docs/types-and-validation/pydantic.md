# Pydantic

The FastAPI and Django Ninja targets write a Pydantic 2 model for each schema of your contract. Pydantic checks the request before your handler runs.

Used by: [FastAPI](../backend/fastapi.md) and [Django Ninja](../backend/ninja.md).

## Set up

Nothing to add: the `pypi:seampact-fastapi` or `pypi:seampact-ninja` target writes the models. Its one option for validation is `rules`.

```yaml
# seampact.config.yaml, under targets
  - id: notes
    out: notes
    use: pypi:seampact-fastapi
    api: notes
    options: { rules: seampact-consistent }
```

The models land in `schemas.py` of the generated folder, for example `generated/notes/schemas.py`.

## What you get

For the `CreateTask` schema of the [overview](README.md):

<!-- excerpt: python/fastapi/fastapi_tests/golden/reference/tasks/schemas.py -->
```python
class CreateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _typing.Annotated[str, _pydantic.Field(min_length=1, max_length=200)]
```

An optional member is `Omittable[...] = None`. A `uuid` is `WireUuid`, a `date-time` is `WireDateTime`, and an enum is a `StrEnum`. The helpers come from `seampact.codegen.runtime.pydantic`.

## Use them in your code

```python
from generated.notes.schemas import CreateTask

task = CreateTask.model_validate({"title": "Buy milk"})
```

## When a check fails

Each Pydantic error becomes an issue of the [400 body](README.md#when-a-check-fails), named by the contract rule, not by Pydantic's error type.

## Native or consistent rules

With the default `rules: native`, the models use Pydantic's own `Field` arguments, as above. With `rules: seampact-consistent`, they use seampact's checks, equal on every target ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)):

<!-- excerpt: python/codegen/tests/golden/reference/tasks_consistent/schemas.py -->
```python
class CreateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _typing.Annotated[str, _seampact.length(min_length=1, max_length=200)]
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None
```

## Limits

The Python generators refuse by name a `oneOf`, a map schema, an open or narrowed enum and a property `default` ([Generate fails](../troubleshooting/generate.md#python)).

## Next

- [FastAPI](../backend/fastapi.md) or [Django Ninja](../backend/ninja.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
