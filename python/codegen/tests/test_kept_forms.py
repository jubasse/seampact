"""The contract forms no Python target serves, refused by name for every target alike: the reference contract passes,
and each form absent from it is refused with its code."""

import json
from pathlib import Path
from typing import Final

import pytest

from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.refusals import Refusals
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport, read_ir
from seampact.ir.run.generator import GenerationRefusedError

_SUPPORT = IrSupport.of_model(kinds=["httpOperation"])

type IrJson = dict[str, object]


def _ir_json(repository_root: Path, api: str) -> IrJson:
    loaded: IrJson = json.loads((repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text("utf-8"))
    return loaded


def _operation(ir_json: IrJson, operation_id: str) -> dict[str, object]:
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    found: dict[str, object] = next(operation for operation in operations if operation["id"] == operation_id)
    return found


def _refusals_of(ir: ContractIR) -> Refusals:
    refusals = Refusals("server", "test", "seampact-test")
    refuse_kept_forms(ir, refusals)
    return refusals


def _refused_codes(ir_json: IrJson) -> dict[str, str]:
    refusals = _refusals_of(read_ir(json.dumps(ir_json), _SUPPORT))

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    return {problem.code: problem.message for problem in refused.value.problems}


@pytest.mark.parametrize("api", ["tasks", "tasksService"])
def test_the_reference_contract_has_no_kept_form(repository_root: Path, api: str) -> None:
    assert _refusals_of(read_ir(json.dumps(_ir_json(repository_root, api)), _SUPPORT)).is_empty()


def test_operation_members_absent_from_the_reference_wait_for_a_consumer_after_1_0(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    get_task = _operation(ir_json, "getTask")
    get_task["upstream"] = ["billing"]
    get_task["principalRequires"] = [
        {"field": "verified", "origin": {"layer": "api", "pointer": "/principalRequires/0"}}
    ]

    refused = _refused_codes(ir_json)

    assert set(refused) == {"upstream.unsupported", "principalRequires.unsupported"}
    assert "it comes after 1.0" in refused["upstream.unsupported"]


def test_access_forms_that_1_0_refuses_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    get_task = _operation(ir_json, "getTask")
    get_task["bindings"] = [
        {
            "from": {"in": "body", "name": "ownerId"},
            "to": {"in": "principal", "name": "profileId"},
            "origin": {"layer": "api", "pointer": "/bindings/0"},
        }
    ]
    scopes = get_task["scopes"]
    assert isinstance(scopes, list)
    scopes[0]["source"] = {"in": "resolver"}
    identities = ir_json["identities"]
    assert isinstance(identities, dict)
    identities["user"]["principal"] = {"kind": "variants", "variants": {"viewer": "UserPrincipal"}}

    assert set(_refused_codes(ir_json)) == {
        "bindings.unsupported",
        "scope.source.unsupported",
        "principal.variants.unsupported",
    }


def test_a_signature_verified_by_the_application_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    schemes = ir_json["schemes"]
    assert isinstance(schemes, dict)
    schemes["stripeSignature"]["signature"] = {"verify": "application", "headers": ["Stripe-Signature"]}

    assert "signature.application.unsupported" in _refused_codes(ir_json)


def test_an_open_enum_and_a_parameter_default_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    enums = ir_json["enums"]
    assert isinstance(enums, dict)
    enums["TaskState"]["fallback"] = enums["TaskState"]["values"][0]
    params = _operation(ir_json, "listTasks")["params"]
    assert isinstance(params, dict)
    params["query"][1]["default"] = 20

    assert set(_refused_codes(ir_json)) == {"enum.open.unsupported", "param.default.unsupported"}


def test_a_format_meta_member_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    formats = ir_json["formats"]
    assert isinstance(formats, dict)
    format_id = str(_operation(ir_json, "getTask")["format"])
    formats[format_id]["meta"] = {
        "traceId": {"type": {"kind": "scalar", "type": "string", "refinements": {}}, "fill": "traceId"}
    }

    assert "format.meta.unsupported" in _refused_codes(ir_json)


@pytest.mark.parametrize(
    ("scheme", "code"),
    [
        ({"kind": "query", "name": "api_key"}, "scheme.query.unsupported"),
        ({"kind": "basic"}, "scheme.basic.unsupported"),
    ],
)
def test_a_query_or_basic_credential_scheme_is_refused_by_name(
    repository_root: Path, scheme: dict[str, str], code: str
) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    schemes = ir_json["schemes"]
    assert isinstance(schemes, dict)
    schemes["bearer"] = {"id": "bearer", **scheme, "origin": schemes["bearer"]["origin"]}

    refused = _refused_codes(ir_json)

    assert set(refused) == {code}
    assert f"A '{scheme['kind']}' credential scheme" in refused[code]


_TEXT: Final = {"kind": "scalar", "refinements": {}, "type": "string"}
_ORIGIN: Final = {"layer": "api", "pointer": "/surfaces/app/routes/channels/member/routes/tasks"}


def test_an_etag_whose_if_match_writes_the_api_does_not_serve_waits_after_1_0(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    responses = _operation(ir_json, "getTask")["responses"]
    assert isinstance(responses, list)
    responses[0]["headers"] = [
        {
            "name": "ETag",
            "type": _TEXT,
            "required": True,
            "derivedFrom": {"derivation": "concurrency.version", "from": [_ORIGIN]},
        }
    ]

    assert set(_refused_codes(ir_json)) == {"concurrency.etag.withoutWrite.unsupported"}


def test_a_successor_link_to_another_api_waits_after_1_0(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    get_task = _operation(ir_json, "getTask")
    get_task["deprecated"] = {
        "since": "2027-01-01",
        "sunset": "2027-06-30",
        "successor": {"api": "billing", "id": "getInvoice", "kind": "httpOperation"},
        "successorRel": "successor-version",
        "origin": _ORIGIN,
    }
    responses = get_task["responses"]
    assert isinstance(responses, list)
    responses[0]["headers"] = [
        {
            "name": "Link",
            "type": _TEXT,
            "required": True,
            "semantic": "successorLink",
            "derivedFrom": {"derivation": "deprecation.headers", "from": [_ORIGIN]},
        }
    ]

    assert set(_refused_codes(ir_json)) == {"deprecated.successor.otherApi.unsupported"}


def test_a_page_header_written_from_an_object_waits_after_1_0(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    pagings = ir_json["pagings"]
    assert isinstance(pagings, dict)
    pagings["cursor"]["response"]["headers"] = [
        {"name": "X-Items", "value": {"kind": "slot", "slot": "items", "path": []}},
        {"name": "X-Next", "value": {"kind": "slot", "slot": "nextCursor", "path": []}},
    ]

    refused = _refused_codes(ir_json)

    assert set(refused) == {"paging.response.header.unsupported"}
    assert "'X-Items'" in refused["paging.response.header.unsupported"]


def test_a_page_body_writing_slots_the_page_reply_does_not_fill_is_refused_by_name(repository_root: Path) -> None:
    # HAL's page names its `_embedded` member by `$collection` and links each item by `$itemSelf`, which the page reply
    # does not fill: the boundary would drop them, so the style is refused by name.
    ir_json = _ir_json(repository_root, "tasks")
    hal_json = json.loads((repository_root / "fixtures/golden/pack-hal/tasks.ir.json").read_text("utf-8"))
    pagings = ir_json["pagings"]
    assert isinstance(pagings, dict)
    pagings["cursor"]["response"]["body"] = hal_json["pagings"]["halPages"]["response"]["body"]

    refused = _refused_codes(ir_json)

    assert (
        "The page slots '$collection', '$itemSelf' of the paging style 'cursor'"
        in refused["paging.response.slot.unsupported"]
    )


def test_a_page_number_slot_under_an_offset_style_is_refused_by_name(repository_root: Path) -> None:
    # The page reply fills `$page` for a page-number style only: an offset style's page number has no declared base.
    ir_json = json.loads((repository_root / "fixtures/golden/pack-laravel/tasks.ir.json").read_text("utf-8"))
    pagings = ir_json["pagings"]
    assert isinstance(pagings, dict)
    pagings["laravelPages"]["position"] = "offset"

    refused = _refused_codes(ir_json)

    assert "The page slots '$page' of the paging style 'laravelPages'" in refused["paging.response.slot.unsupported"]
