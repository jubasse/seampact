"""The endpoints a developer writes are checked against the generated protocol by mypy: a handler that returns another
operation's result is a type error, and one that returns its own is not."""

import re
from pathlib import Path
from typing import Final

import pytest
from mypy import api as mypy_api

_PYTHON: Final = Path(__file__).resolve().parents[2]
_GOLDEN_ROOTS: Final = {
    "fastapi": _PYTHON / "fastapi/fastapi_tests/golden/reference",
    "drf": _PYTHON / "drf/drf_tests/golden/reference",
    "ninja": _PYTHON / "ninja/ninja_tests/golden/reference",
}
_PROTOCOL: Final = "TasksEndpoints"
_HANDLER_SIGNATURE: Final = re.compile(r"def (\w+)\(\s*self, request: (\w+)Request")
_OPERATION_WITH_WRONG_RESULT: Final = "archive_task"
_RESULT_OF_ANOTHER_OPERATION: Final = "AssignTaskResult"


def _handlers(operations_source: str) -> list[tuple[str, str]]:
    start = operations_source.index(f"class {_PROTOCOL}")
    end = operations_source.index("\nclass ", start + 1)

    return _HANDLER_SIGNATURE.findall(operations_source[start:end])


def _endpoints_class(name: str, handlers: list[tuple[str, str]], wrong_result: str | None) -> str:
    lines = [f"class {name}:"]

    for method, operation in handlers:
        result = wrong_result if method == _OPERATION_WITH_WRONG_RESULT and wrong_result else f"{operation}Result"
        lines += [
            f"    def {method}(self, request: {operation}Request) -> {result}:",
            "        raise NotImplementedError",
            "",
        ]

    return "\n".join(lines)


def _program(operations_source: str) -> tuple[str, int]:
    handlers = _handlers(operations_source)
    names = sorted({f"{operation}{suffix}" for _, operation in handlers for suffix in ("Request", "Result")})
    text = "\n".join(
        [
            f"from tasks.operations import {_PROTOCOL}, {', '.join(names)}",
            "",
            "",
            _endpoints_class("Right", handlers, None),
            "",
            _endpoints_class("Wrong", handlers, _RESULT_OF_ANOTHER_OPERATION),
            "",
            f"def right() -> {_PROTOCOL}:",
            "    return Right()",
            "",
            "",
            f"def wrong() -> {_PROTOCOL}:",
            "    return Wrong()",
            "",
        ]
    )
    wrong_line = text.splitlines().index("    return Wrong()") + 1

    return text, wrong_line


@pytest.mark.parametrize("target", sorted(_GOLDEN_ROOTS))
def test_a_handler_returning_another_operations_result_is_a_type_error(
    target: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _GOLDEN_ROOTS[target]
    text, wrong_line = _program((root / "tasks/operations.py").read_text(encoding="utf-8"))
    program = tmp_path / "endpoints.py"
    program.write_text(text, encoding="utf-8")
    monkeypatch.setenv("MYPYPATH", str(root))

    report, errors, status = mypy_api.run(
        ["--config-file", str(_PYTHON / "pyproject.toml"), "--cache-dir", str(tmp_path / "cache"), str(program)]
    )

    assert errors == ""
    assert status == 1
    expected = f'{program}:{wrong_line}: error: Incompatible return value type (got "Wrong", expected "{_PROTOCOL}")'
    assert [line.removesuffix("  [return-value]") for line in report.splitlines() if ": error:" in line] == [expected]
