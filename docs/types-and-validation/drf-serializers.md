# DRF serializers

The Django REST Framework target writes a frozen dataclass for each schema of your contract, and a serializer for each input. DRF checks the request before your handler runs.

Used by: [Django REST Framework](../backend/drf.md).

## Set up

Nothing to add: the `pypi:seampact-drf` target writes the classes. Its one option for validation is `rules`.

```yaml
# seampact.config.yaml, under targets
  - id: notes
    out: notes
    use: pypi:seampact-drf
    api: notes
```

## What you get

A schema is a frozen dataclass in `schemas.py`. For the `CreateTask` schema of the [overview](README.md):

<!-- excerpt: python/drf/drf_tests/golden/reference/tasks/schemas.py -->
```python
@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTask:
    title: str
    effort: int | None = None
```

Each input is a serializer in `drf.py`, built from the contract:

<!-- excerpt: python/drf/drf_tests/golden/reference/tasks/drf.py -->
```python
class CreateTaskSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'CreateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "title": _drf_runtime.ContractTextField(min_length=1, max_length=200),
            "effort": _serializers.IntegerField(required=False, min_value=0),
        }
```

## When a check fails

Each DRF error becomes an issue of the [400 body](README.md#when-a-check-fails), named by the contract rule.

## Native or consistent rules

With the default `rules: native`, the serializers use DRF's own field arguments (`min_length`, `max_length`, `min_value`, `max_value`). With `rules: seampact-consistent`, they give the contract's exact checks, equal on every target ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)). A rule with no DRF check stops `generate` with `rule.<key>.unsupported`.

## Limits

The Python generators refuse by name a `oneOf`, a map schema, an open or narrowed enum and a property `default` ([Generate fails](../troubleshooting/generate.md#python)).

## Next

- [Django REST Framework](../backend/drf.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
