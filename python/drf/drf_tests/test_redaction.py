"""What the DRF target prints of a request's values (ADR 0026 "Redaction"): a sensitive member of a schema dataclass,
a signed route's body, who is calling and the scopes in a handler's request, the data a serializer validates, and an
idempotent replay never show in a `repr`, a `str`, `pprint` or rich output. A validation error of a field the
generator emits never echoes the value it refused."""

import pprint
import uuid
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest
import rich.pretty
from rest_framework import serializers

from seampact.codegen.runtime.idempotency import IdempotencyReplayed
from seampact.codegen.runtime.replies import Reply
from seampact.django.runtime.idempotency_records import ReplayedReplyError
from seampact.drf.runtime import ContractSerializer, ContractTextField, SerializerFields, TypedValueField
from seampact.drf.runtime.validators import pattern
from seampact.ir.config.json_value import JsonValue

from .test_drf_generator import contract, generated_files, imported_package, reference_ir, write_package

_PACKAGE: Final = "seampact_drf_redaction_tasks"
_SECRET: Final = "secret-locale-fr"
_USER_ID: Final = "8d0f3c3e-6a52-4c0e-9b8e-3f1f2f6f1a11"
_REDACTED: Final = "[redacted]"


@pytest.fixture(scope="module")
def package(repository_root: Path, tmp_path_factory: pytest.TempPathFactory) -> ModuleType:
    directory = tmp_path_factory.mktemp("redaction") / _PACKAGE
    write_package(generated_files(contract(_sensitive_locale_ir(repository_root))), directory)

    return imported_package(directory, _PACKAGE)


def test_a_sensitive_member_of_a_schema_prints_redacted(package: ModuleType) -> None:
    preferences = package.schemas.Preferences(locale=_SECRET, digest=True)

    assert repr(preferences) == "Preferences(locale=[redacted], digest=True)"
    assert _SECRET not in str(preferences)
    assert [(name, repr(value)) for name, value in preferences.__rich_repr__()] == [
        ("locale", _REDACTED),
        ("digest", "True"),
    ]
    assert preferences.locale == _SECRET


def test_who_is_calling_prints_redacted_in_the_handlers_request(package: ModuleType) -> None:
    principal = package.schemas.UserPrincipal(user_id=uuid.UUID(_USER_ID))
    # The input is not what the test reads, so any value stands in for it.
    request = package.operations.GetPreferencesRequest(input=None, principal=principal)

    assert _USER_ID not in repr(request)
    assert "principal=[redacted]" in repr(request)


_RENDERINGS: Final[dict[str, Callable[[object], str]]] = {
    "repr": repr,
    "str": str,
    "pprint": pprint.pformat,
    "rich": rich.pretty.pretty_repr,
}


def _secret_holders(package: ModuleType) -> dict[str, object]:
    operations = package.operations

    return {
        "signed route body": operations.PaymentsInput(body=_SECRET),
        "handler request principal": operations.PaymentsRequest(input=None, principal=_SECRET),
        "handler request scopes": operations.PurgeTaskRequest(input=None, principal=None, scopes=_SECRET),
    }


@pytest.mark.parametrize("rendering", sorted(_RENDERINGS))
@pytest.mark.parametrize("holder", ["signed route body", "handler request principal", "handler request scopes"])
def test_a_secret_of_a_handlers_request_is_printed_redacted(package: ModuleType, holder: str, rendering: str) -> None:
    printed = _RENDERINGS[rendering](_secret_holders(package)[holder])

    assert _SECRET not in printed
    assert _REDACTED in printed


def test_the_handlers_request_still_shows_its_input(package: ModuleType) -> None:
    request = package.operations.PurgeTaskRequest(input="the-input", principal=None, scopes=None)

    assert repr(request) == "PurgeTaskRequest(input='the-input', principal=[redacted], scopes=[redacted])"


def test_the_body_of_an_unsigned_route_keeps_its_repr(package: ModuleType) -> None:
    body = package.schemas.Preferences(locale="fr", digest=True)

    assert "digest=True" in repr(package.operations.UpdatePreferencesInput(headers=None, body=body))


def _refusing_fields() -> SerializerFields:
    return {
        "integer": serializers.IntegerField(),
        "float": serializers.FloatField(),
        "boolean": serializers.BooleanField(),
        "regex": serializers.RegexField(r"^[0-9]+$"),
        "list": serializers.ListField(child=serializers.IntegerField()),
        "text with a pattern": ContractTextField(validators=[pattern("^[0-9]+$")]),
        "typed value": TypedValueField(Decimal),
    }


@pytest.mark.parametrize("field", sorted(_refusing_fields()))
def test_a_validation_error_never_echoes_the_refused_value(field: str) -> None:
    refused = [_SECRET] if field == "list" else _SECRET

    with pytest.raises(serializers.ValidationError) as error:
        _refusing_fields()[field].run_validation(refused)

    assert _SECRET not in str(error.value)
    assert _SECRET not in repr(error.value)


def test_a_schema_without_a_sensitive_member_keeps_its_dataclass_repr(package: ModuleType) -> None:
    health = package.schemas.Health(status="ok")

    assert repr(health) == "Health(status='ok')"


def test_a_serializer_prints_none_of_the_data_it_validates() -> None:
    serializer = ContractSerializer(data={"locale": _SECRET})

    assert _SECRET not in repr(serializer)


def test_an_idempotent_replay_prints_none_of_the_stored_reply() -> None:
    replayed = ReplayedReplyError(IdempotencyReplayed(Reply(200, (), _SECRET.encode())))

    assert _SECRET not in repr(replayed)
    assert _SECRET not in str(replayed)


def _sensitive_locale_ir(repository_root: Path) -> dict[str, JsonValue]:
    """The reference contract with `Preferences.locale` marked sensitive."""
    ir = reference_ir(repository_root, "tasks")
    schemas = ir["schemas"]
    assert isinstance(schemas, dict)
    preferences = schemas["Preferences"]
    assert isinstance(preferences, dict) and isinstance(preferences["properties"], list)

    for member in preferences["properties"]:
        assert isinstance(member, dict)
        member["sensitive"] = member["name"] == "locale"

    return ir
