"""The package's types against the shape manifest the npm, Java and PHP hooks packages share.

The Python reading of the manifest: a member or method name reads as snake_case; a record or an interface is a frozen
slotted dataclass whose fields are its members, an optional member defaulting to None and a nullable one allowing None
without a default; a nested `Owner.Member` is a class inside the owner; a union is a `type` alias in its own module,
named after the union in snake_case, whose named arms are classes of that module; a hook is a `Protocol` whose methods
return `T | Awaitable[T]`; an enum lists the manifest's values; a discriminant is the arm's type itself.
"""

import dataclasses
import enum
import importlib
import inspect
import json
import re
import types
import typing
from collections.abc import Awaitable
from pathlib import Path
from typing import Any, Final

import seampact.hooks

# python/hooks/tests/test_hooks_shape.py: the repository root is three directories up from this one.
_MANIFEST_PATH: Final = Path(__file__).resolve().parents[3] / "fixtures/hooks-shape/shape.json"
_PYTHON_LANGUAGE: Final = "python"
_NESTED_TYPE_SEPARATOR: Final = "."
_VOID: Final = "void"
_PACKAGE: Final = "seampact.hooks"
_CAMEL_BOUNDARY: Final = re.compile(r"(?<!^)(?=[A-Z])")

type Entry = dict[str, Any]


def _manifest() -> list[Entry]:
    manifest: dict[str, Any] = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    entries: list[Entry] = manifest["types"]

    return entries


def _in_python(entry: Entry) -> bool:
    return "languages" not in entry or _PYTHON_LANGUAGE in entry["languages"]


def _snake_case(name: str) -> str:
    return _CAMEL_BOUNDARY.sub("_", name).lower()


# `object` stands for any value but None, as PHP's `object` does: a member that allows None says so.
def _allows_none(hint: object) -> bool:
    return type(None) in typing.get_args(hint)


class _ShapeCheck:
    def __init__(self) -> None:
        self.problems: list[str] = []

    def check(self, entries: list[Entry]) -> list[str]:
        python_entries = [entry for entry in entries if _in_python(entry)]

        for entry in python_entries:
            self._check_entry(entry)

        listed_names = {entry["name"] for entry in python_entries if _NESTED_TYPE_SEPARATOR not in entry["name"]}

        for exported_name in sorted(set(seampact.hooks.__all__) - listed_names):
            self.problems.append(f"{exported_name}: exported by Python but not in the shape manifest")

        return self.problems

    def _resolve(self, name: str) -> object | None:
        owner_name, _, nested_name = name.partition(_NESTED_TYPE_SEPARATOR)
        owner = getattr(seampact.hooks, owner_name, None)

        return owner if owner is None or nested_name == "" else getattr(owner, nested_name, None)

    def _check_entry(self, entry: Entry) -> None:
        name = entry["name"]
        resolved = self._resolve(name)

        if resolved is None:
            self.problems.append(f"{name}: no Python type of this name")
            return

        match entry["kind"]:
            case "record" | "interface":
                self._check_record(name, resolved, entry.get("members", []))
            case "hook":
                self._check_hook(name, resolved, entry["methods"])
            case "union":
                self._check_union(entry, resolved)
            case "enum":
                self._check_enum(name, resolved, entry["values"])
            case "alias":
                pass
            case other:
                self.problems.append(f"{name}: the kind {other!r} is not known to the Python check")

    def _check_record(self, name: str, record: object, members: list[Entry]) -> None:
        if not (isinstance(record, type) and dataclasses.is_dataclass(record)):
            self.problems.append(f"{name}: expected a dataclass")
            return

        parameters = record.__dataclass_params__  # type: ignore[attr-defined]

        if not parameters.frozen or "__slots__" not in vars(record):
            self.problems.append(f"{name}: expected a frozen slotted dataclass")

        fields_by_name = {field.name: field for field in dataclasses.fields(record)}
        hints = typing.get_type_hints(record)
        python_members = [member for member in members if _in_python(member)]
        expected_names = [_snake_case(member["name"]) for member in python_members]

        self._compare_names(name, expected_names, list(fields_by_name))

        for member in python_members:
            field = fields_by_name.get(_snake_case(member["name"]))

            if field is not None:
                self._check_member(f"{name}.{field.name}", member, field, hints[field.name])

    def _check_member(self, where: str, member: Entry, field: dataclasses.Field[Any], hint: object) -> None:
        optional = member.get("optional", False)
        nullable = member.get("nullable", False)
        has_default = field.default is not dataclasses.MISSING

        if optional and field.default is not None:
            self.problems.append(f"{where}: an optional member must default to None")
        elif not optional and has_default:
            self.problems.append(f"{where}: a required member must have no default")

        if (optional or nullable) != _allows_none(hint):
            self.problems.append(f"{where}: allows None only when optional or nullable")

        if "enum" in member and hint is not self._resolve(member["enum"]):
            self.problems.append(f"{where}: expected the enum {member['enum']}, found {hint}")

    def _check_hook(self, name: str, hook: object, methods: list[Entry]) -> None:
        if not (isinstance(hook, type) and getattr(hook, "_is_protocol", False)):
            self.problems.append(f"{name}: expected a Protocol")
            return

        declared = {
            method_name: method
            for method_name, method in vars(hook).items()
            if inspect.isfunction(method) and not method_name.startswith("_")
        }

        self._compare_names(name, [_snake_case(method["name"]) for method in methods], list(declared))

        for expected in methods:
            method = declared.get(_snake_case(expected["name"]))

            if method is not None:
                self._check_signature(f"{name}.{method.__name__}", expected, method)

    def _check_signature(self, where: str, expected: Entry, method: types.FunctionType) -> None:
        parameter_names = list(inspect.signature(method).parameters)[1:]
        expected_parameters = [_snake_case(parameter) for parameter in expected["parameters"]]

        if parameter_names != expected_parameters:
            self.problems.append(f"{where}: parameters {parameter_names}, expected {expected_parameters}")

        returns = expected.get("returns")
        returned = typing.get_type_hints(method)["return"]

        if returns is not None and set(typing.get_args(returned)) != self._returned_or_awaited(returns):
            self.problems.append(f"{where}: returns {returned}, expected {returns} | Awaitable[{returns}]")

    # A void method returns None, any other the named type; either beside its Awaitable.
    def _returned_or_awaited(self, returns: str) -> set[object]:
        if returns == _VOID:
            return {type(None), types.GenericAlias(Awaitable, (None,))}

        returned = self._resolve(returns)

        return {returned, types.GenericAlias(Awaitable, (returned,))}

    def _check_union(self, entry: Entry, alias: object) -> None:
        name = entry["name"]
        module = importlib.import_module(f"{_PACKAGE}.{_snake_case(name)}")

        if getattr(module, name, None) is not alias:
            self.problems.append(f"{name}: expected the alias of the module {module.__name__}")
            return

        expected_arms: list[object] = []

        for arm in entry["arms"]:
            arm_type = getattr(module, arm["name"], None) if "name" in arm else self._resolve(arm["type"])
            arm_name = f"{name}.{arm.get('name', arm.get('type'))}"

            if arm_type is None:
                self.problems.append(f"{arm_name}: no Python type of this name")
                continue

            expected_arms.append(arm_type)

            if "name" in arm:
                self._check_record(arm_name, arm_type, arm.get("members", []))

        joined = typing.get_args(alias.__value__) if isinstance(alias, typing.TypeAliasType) else ()

        if set(joined) != set(expected_arms):
            self.problems.append(f"{name}: the alias joins {joined}, expected {expected_arms}")

    def _check_enum(self, name: str, candidate: object, values: list[str]) -> None:
        if not (isinstance(candidate, type) and issubclass(candidate, enum.Enum)):
            self.problems.append(f"{name}: expected an enum")
            return

        found = [member.value for member in candidate]

        if found != values:
            self.problems.append(f"{name}: values {found}, expected {values}")

    def _compare_names(self, owner: str, expected: list[str], found: list[str]) -> None:
        for missing in [name for name in expected if name not in found]:
            self.problems.append(f"{owner}: missing member {missing}")

        for extra in [name for name in found if name not in expected]:
            self.problems.append(f"{owner}: member {extra} is not in the shape manifest")


def _with_member(entries: list[Entry], type_name: str, member_name: str) -> list[Entry]:
    return [
        {**entry, "members": [*entry.get("members", []), {"name": member_name}]}
        if entry["name"] == type_name
        else entry
        for entry in entries
    ]


def test_matches_the_shape_manifest() -> None:
    assert _ShapeCheck().check(_manifest()) == []


def test_names_a_missing_member() -> None:
    drifted = _with_member(_manifest(), "RequestView", "cookies")

    assert _ShapeCheck().check(drifted) == ["RequestView: missing member cookies"]


def test_names_an_unlisted_type() -> None:
    without_bucket = [entry for entry in _manifest() if entry["name"] != "ThrottleBucket"]

    assert _ShapeCheck().check(without_bucket) == ["ThrottleBucket: exported by Python but not in the shape manifest"]


def test_names_a_hook_whose_return_type_differs() -> None:
    drifted = [
        {**entry, "methods": [{**entry["methods"][0], "returns": "Decision"}]}
        if entry["name"] == "AuthenticateHook"
        else entry
        for entry in _manifest()
    ]

    assert _ShapeCheck().check(drifted) == [
        "AuthenticateHook.authenticate: returns "
        + str(seampact.hooks.AuthenticateResult | Awaitable[seampact.hooks.AuthenticateResult])
        + ", expected Decision | Awaitable[Decision]"
    ]
