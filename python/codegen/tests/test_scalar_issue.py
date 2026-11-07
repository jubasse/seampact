"""The type gate a scope id, a subject id and a rule's proof pass before any hook reads them: a scalar keeps its type,
`uuid` format and length bounds; a proof of any other kind passes it and is checked in full with the body."""

from seampact.codegen.runtime.wire_values import scalar_issue


def test_a_proof_of_an_object_or_array_kind_passes_the_type_gate() -> None:
    assert scalar_issue({"kind": "ref", "schema": "ReauthProof"}, {"by": "x"}) is None
    assert scalar_issue({"kind": "array", "items": {"kind": "scalar", "type": "string"}}, ["a"]) is None


def test_a_scalar_breaking_its_type_format_or_length_names_the_rule() -> None:
    uuid_type = {"kind": "scalar", "type": "string", "format": "uuid"}
    bounded = {"kind": "scalar", "type": "string", "refinements": {"minLength": 2, "maxLength": 3}}

    assert scalar_issue({"kind": "scalar", "type": "integer"}, True) == "type"
    assert scalar_issue({"kind": "scalar", "type": "string"}, 1) == "type"
    assert scalar_issue(uuid_type, "not-a-uuid") == "format"
    assert scalar_issue(uuid_type, "123e4567-e89b-12d3-a456-426614174000") is None
    assert scalar_issue(bounded, "a") == "minLength"
    assert scalar_issue(bounded, "abcd") == "maxLength"
    assert scalar_issue({"kind": "scalar", "type": "number"}, 1.5) is None
