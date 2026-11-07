"""No Python server target generates the controller of an operation: the generated tree declares each handler only
in the `*Endpoints` protocols the developer's class implements, and no class of the tree implements one."""

import ast
from pathlib import Path
from typing import Final

import pytest

_PYTHON: Final = Path(__file__).resolve().parents[2]
_GOLDEN_PACKAGES: Final = {
    "fastapi": _PYTHON / "fastapi/fastapi_tests/golden/reference/tasks",
    "drf": _PYTHON / "drf/drf_tests/golden/reference/tasks",
    "ninja": _PYTHON / "ninja/ninja_tests/golden/reference/tasks",
}
_ENDPOINTS_SUFFIX: Final = "Endpoints"
_REQUEST_SUFFIX: Final = "Request"
_PROTOCOL: Final = "Protocol"


def _classes(directory: Path) -> list[ast.ClassDef]:
    return [
        node
        for path in sorted(directory.glob("*.py"))
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.ClassDef)
    ]


def _base_names(node: ast.ClassDef) -> set[str]:
    return {base.attr if isinstance(base, ast.Attribute) else ast.unparse(base) for base in node.bases}


def _handler_names(node: ast.ClassDef) -> set[str]:
    """The methods that take an operation's request, which is what a handler is."""
    methods = [member for member in node.body if isinstance(member, ast.FunctionDef | ast.AsyncFunctionDef)]

    return {method.name for method in methods if _takes_an_operation_request(method)}


def _takes_an_operation_request(method: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(
        argument.arg == "request"
        and isinstance(argument.annotation, ast.Name)
        and argument.annotation.id.endswith(_REQUEST_SUFFIX)
        for argument in method.args.args + method.args.posonlyargs
    )


@pytest.mark.parametrize("target", sorted(_GOLDEN_PACKAGES))
def test_the_generated_tree_declares_the_handlers_in_protocols_and_implements_none(target: str) -> None:
    classes = _classes(_GOLDEN_PACKAGES[target])
    protocols = [node for node in classes if node.name.endswith(_ENDPOINTS_SUFFIX)]
    handler_names = set().union(*(_handler_names(node) for node in protocols))

    assert handler_names >= {"get_task", "archive_task", "list_tasks", "health"}
    assert all(_PROTOCOL in _base_names(node) for node in protocols)

    for node in classes:
        if node in protocols:
            continue

        assert _handler_names(node) == set(), f"{node.name} implements a handler"
        assert not any(base.endswith(_ENDPOINTS_SUFFIX) for base in _base_names(node)), (
            f"{node.name} implements endpoints"
        )
