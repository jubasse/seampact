"""What the DRF target prints of a request's values (ADR 0026 "Redaction"): a sensitive member of a schema dataclass,
who is calling in a handler's request, the data a serializer validates, and an idempotent replay never show in a
`repr`, a `str` or rich output."""

import uuid
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest

from seampact.codegen.runtime.idempotency import IdempotencyReplayed
from seampact.codegen.runtime.replies import Reply
from seampact.django.runtime.idempotency_records import ReplayedReplyError
from seampact.drf.runtime import ContractSerializer
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
