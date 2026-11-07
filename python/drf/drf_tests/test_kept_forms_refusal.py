"""The generator itself refuses the access, credential and signature forms 1.0 leaves out, each by name: the shared
kept-forms check is wired into `generate`."""

import json
from pathlib import Path

import pytest

from seampact.ir.run.generator import GenerationRefusedError

from .test_drf_generator import contract, generated_files

_REFUSED_CODES = {
    "bindings.unsupported",
    "scope.source.unsupported",
    "principal.variants.unsupported",
    "principalRequires.unsupported",
    "upstream.unsupported",
    "scheme.basic.unsupported",
    "signature.application.unsupported",
}


def test_the_forms_1_0_leaves_out_are_refused_by_name_through_the_generator(repository_root: Path) -> None:
    # Read untyped, as the other targets' refusal tests do: the test edits nested members by key.
    ir_json = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))
    get_task = next(operation for operation in ir_json["operations"] if operation["id"] == "getTask")
    get_task["upstream"] = ["billing"]
    get_task["principalRequires"] = [
        {"field": "verified", "origin": {"layer": "api", "pointer": "/principalRequires/0"}}
    ]
    get_task["bindings"] = [
        {
            "from": {"in": "body", "name": "ownerId"},
            "to": {"in": "principal", "name": "profileId"},
            "origin": {"layer": "api", "pointer": "/bindings/0"},
        }
    ]
    get_task["scopes"][0]["source"] = {"in": "resolver"}
    ir_json["identities"]["user"]["principal"] = {"kind": "variants", "variants": {"viewer": "UserPrincipal"}}
    ir_json["schemes"]["bearer"] = {"id": "bearer", "kind": "basic", "origin": ir_json["schemes"]["bearer"]["origin"]}
    ir_json["schemes"]["stripeSignature"]["signature"] = {"verify": "application", "headers": ["Stripe-Signature"]}

    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(ir_json))

    assert {problem.code for problem in refused.value.problems} >= _REFUSED_CODES
