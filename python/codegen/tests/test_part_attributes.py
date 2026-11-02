"""The attributes of the parameters of one part (path, query or headers): two parameters that give one attribute are
refused naming both, as two members of one object are."""

import pytest

from seampact.codegen.names import part_attributes
from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import Param, Refinements, ScalarType, ScalarTypeUse
from seampact.ir.run.generator import GenerationRefusedError

_TEXT = ScalarTypeUse(type=ScalarType.STRING, refinements=Refinements())
_QUERY = IrPlace("/operations/0/params/query", "listChannels")


def test_each_parameter_gets_its_attribute_by_position() -> None:
    refusals = Refusals("reference", "drf", "seampact-drf")
    params = [Param("pageSize", _TEXT, False), Param("2fa", _TEXT, False)]

    attributes = part_attributes(params, _QUERY, refusals)

    assert refusals.is_empty()
    assert [(index, param.name, attribute) for index, param, attribute in attributes] == [
        (0, "pageSize", "page_size"),
        (1, "2fa", "field_2fa"),
    ]


def test_two_parameters_giving_one_attribute_are_refused_naming_both() -> None:
    refusals = Refusals("reference", "drf", "seampact-drf")

    part_attributes([Param("2fa", _TEXT, False), Param("field_2fa", _TEXT, False)], _QUERY, refusals)

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    [problem] = refused.value.problems
    assert problem.code == "name.collision"
    assert "/params/query/0" in problem.message and "/params/query/1" in problem.message
