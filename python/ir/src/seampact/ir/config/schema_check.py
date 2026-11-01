"""A config value checked against `app.schema.json` or `root.schema.json` of `@seampact/spec` (shipped copies),
through the pinned JSON Schema validator, so the schema is never ported by hand. Each error becomes the problem
`config.schema` in the Node CLI's forms: an unknown key, a missing key, a `oneOf` the value fits none of, or another
keyword. A `oneOf` names the innermost value that fits none of its forms."""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from functools import cache
from itertools import islice
from typing import Final

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from seampact.ir.bundle.spec_schema import schema_document
from seampact.ir.config.config_kind import ConfigKind
from seampact.ir.config.config_tree import ConfigTree
from seampact.ir.config.json_value import JsonValue, as_mapping
from seampact.ir.config.key_path import format_key_path, is_at_or_below, is_below
from seampact.ir.config.problem import ConfigProblem

_ERRORS_MAX: Final = 1000
_ONE_OF: Final = "oneOf"
_MESSAGE_CHARACTERS_MAX: Final = 200
_SCHEMA_FIX: Final = "Correct the value as the config schema states (ADR 0011 'The app config')."
_MOUNT_KEY: Final = "mount"
_MOUNT_RULE: Final = (
    "The key 'mount' is '/' then segments of ASCII letters, digits and '-._~!$&'()+,;=@:', with no trailing '/', no "
    "'*', no '.' or '..' segment and no segment starting with ':'."
)
_MOUNT_FIX: Final = "Write the path prefix the api is served under, such as '/api' (ADR 0011 'The app config')."
_ALLOW_UNTESTED_KEY: Final = "allowUntested"
_ALLOW_UNTESTED_RULE: Final = (
    "An `allowUntested` item is '<framework>@<major>', or '<framework>@0.<minor>' for a 0.x framework; a major of 1 or "
    "more takes no minor."
)
_ALLOW_UNTESTED_FIX: Final = (
    "Write '<framework>@<major>' (such as 'spring-boot@4', not 'spring-boot@4.1'), or '<framework>@0.<minor>' for a "
    "0.x framework (such as 'fastapi@0.162')."
)
_USE_KEY: Final = "use"
_TARGET_USE_RULE: Final = (
    "The key 'use' names a PyPI distribution as the lowercase prefix 'pypi:' then its PEP 503 normalised name "
    "(lowercase ASCII letters and digits, runs joined by one '-'); the prefix 'pypi:' in any case is reserved for "
    "this form, so the Maven group 'pypi' is never a coordinate."
)
_TARGET_USE_FIX: Final = (
    "Write the prefix as 'pypi:' then the distribution's normalised name, such as 'pypi:seampact-fastapi' "
    "(ADR 0011 'The app config')."
)


@dataclass(frozen=True, slots=True)
class KeyProblem:
    """A problem the reader reports at a key before the schema check; the schema errors at or under it would repeat
    it."""

    path: tuple[str | int, ...]
    problem: ConfigProblem


@dataclass(frozen=True, slots=True)
class _Located:
    key_path: str
    is_one_of: bool
    problem: ConfigProblem


@cache
def _validator(kind: ConfigKind) -> Draft202012Validator:
    return Draft202012Validator(schema_document(f"config/{kind.schema_file}"))


def schema_problems(tree: ConfigTree, kind: ConfigKind, key_problems: Sequence[KeyProblem] = ()) -> list[ConfigProblem]:
    """The key problems first, then the schema problems they do not cover; empty when the value is valid."""
    problems = [key_problem.problem for key_problem in key_problems]
    reported = [format_key_path(key_problem.path) for key_problem in key_problems]
    seen: set[str] = set()

    for error in islice(_validator(kind).iter_errors(tree.value), _ERRORS_MAX):
        for located in _located(error, tree, kind):
            if _is_covered(located, reported):
                continue

            identity = f"{located.problem.message}|{located.problem.where}"

            if identity not in seen:
                seen.add(identity)
                problems.append(located.problem)

    return problems


def _is_covered(located: _Located, reported: Iterable[str]) -> bool:
    """A problem at or under a reported key repeats it; a `oneOf` that fails because of a reported key names it too."""
    return any(
        is_at_or_below(located.key_path, path) or (located.is_one_of and is_below(path, located.key_path))
        for path in reported
    )


def _located(error: ValidationError, tree: ConfigTree, kind: ConfigKind) -> list[_Located]:
    path = list(error.absolute_path)

    if error.validator == _ONE_OF:
        deeper = _deeper_one_ofs(error, format_key_path(path))

        if not deeper:
            return [_Located(format_key_path(path), True, _one_of_problem(tree, path))]

        return [located for inner in deeper for located in _located(inner, tree, kind)]

    inner_errors = list(error.context or [])

    if inner_errors:
        return [located for inner in inner_errors for located in _located(inner, tree, kind)]

    return _leaf_problems(error, path, tree, kind)


def _deeper_one_ofs(error: ValidationError, key_path: str) -> list[ValidationError]:
    """An outer `oneOf` fails because an inner one did; the inner one names the value to correct."""
    found: list[ValidationError] = []

    for inner in error.context or []:
        if inner.validator == _ONE_OF and is_below(format_key_path(list(inner.absolute_path)), key_path):
            found.append(inner)
        else:
            found.extend(_deeper_one_ofs(inner, key_path))

    return found


def _leaf_problems(error: ValidationError, path: list[str | int], tree: ConfigTree, kind: ConfigKind) -> list[_Located]:
    key_path = format_key_path(path)

    if error.validator == "additionalProperties":
        return [
            _Located(
                format_key_path([*path, key]),
                False,
                ConfigProblem(
                    "config.schema",
                    f"'{key}' is not a key the {kind.title} takes here.",
                    "Remove the key, or correct its spelling (ADR 0011 'The app config').",
                    tree.where_of([*path, key]),
                ),
            )
            for key in _unknown_keys(error)
        ]

    if error.validator == "required":
        instance = as_mapping(_json(error.instance))
        required = error.validator_value if isinstance(error.validator_value, list) else []

        return [
            _Located(
                key_path,
                False,
                ConfigProblem(
                    "config.schema", f"The key '{name}' is required here.", f"Add '{name}'.", tree.where_of(path)
                ),
            )
            for name in required
            if isinstance(name, str) and name not in instance
        ]

    last = path[-1] if path else None

    if error.validator == "pattern" and len(path) >= 2 and path[-2] == _ALLOW_UNTESTED_KEY:
        return [
            _Located(
                key_path,
                False,
                ConfigProblem("config.schema", _ALLOW_UNTESTED_RULE, _ALLOW_UNTESTED_FIX, tree.where_of(path)),
            )
        ]

    if error.validator == "pattern" and last == _MOUNT_KEY:
        return [_Located(key_path, False, ConfigProblem("config.schema", _MOUNT_RULE, _MOUNT_FIX, tree.where_of(path)))]

    if error.validator == "pattern" and last == _USE_KEY:
        return [
            _Located(
                key_path,
                False,
                ConfigProblem("config.schema", _TARGET_USE_RULE, _TARGET_USE_FIX, tree.where_of(path)),
            )
        ]

    message = error.message[:_MESSAGE_CHARACTERS_MAX]

    return [
        _Located(
            key_path,
            False,
            ConfigProblem(
                "config.schema",
                f"The value fails the schema keyword '{error.validator}': {message}.",
                _SCHEMA_FIX,
                tree.where_of(path),
            ),
        )
    ]


def _json(value: object) -> JsonValue:
    return value if isinstance(value, dict | list | str | int | float | bool | type(None)) else None


def _unknown_keys(error: ValidationError) -> list[str]:
    """The members no `properties` or `patternProperties` entry of the schema names."""
    schema = as_mapping(error.schema) if isinstance(error.schema, dict) else {}
    properties = as_mapping(schema.get("properties"))
    patterns = list(as_mapping(schema.get("patternProperties")))

    return [
        key
        for key in as_mapping(_json(error.instance))
        if key not in properties and not any(re.search(pattern, key) for pattern in patterns)
    ]


def _one_of_problem(tree: ConfigTree, path: list[str | int]) -> ConfigProblem:
    message, fix = _one_of_sentences(path)

    return ConfigProblem("config.schema", message, fix, tree.where_of(path))


def _one_of_sentences(path: list[str | int]) -> tuple[str, str]:
    """The forms a `oneOf` of the config schemas lets a value take, by where it sits."""
    first = path[0] if path else None
    last = path[-1] if path else None
    before_last = path[-2] if len(path) >= 2 else None

    if first == "sources":
        return (
            "A source takes one form: 'path', 'package' with 'version', 'release', 'git' or 'maven'; 'integrity' "
            "goes with a bundle form only.",
            "Keep the keys of one form (ADR 0011 'The app config').",
        )

    if last == "frameworkRoutes" and before_last == "bootCheck":
        return (
            "'bootCheck.frameworkRoutes' is true, false or 'strict'.",
            "Write true to check the app routes under the contract's base paths, 'strict' to check every app route, "
            "or false to switch the check off.",
        )

    if last == "bootCheck":
        return (
            "'bootCheck' is true, false or '{ frameworkRoutes }'.",
            "Switch the boot check with a boolean, or its framework-route check alone with "
            "'{ frameworkRoutes: false }'.",
        )

    if first == "targets":
        return (
            "A target entry takes exactly one of 'api' and 'apis'.",
            "Name one api with 'api', or several with 'apis'.",
        )

    if last == "extensions":
        return (
            "'extensions' is 'all', 'none' or a list of extension names.",
            "Write 'all', 'none' or a list such as [access, paging].",
        )

    if len(path) == 1:
        return (
            "'openapi' is 'none' or a mapping from api names to their documents.",
            "Write 'openapi: none', or map each api to its document's path.",
        )

    return (
        "An api's documents are a path, '{ path, ...options }', or a mapping from each document id to one of those.",
        "Write the path of the api's one document, or map each of its documents to a path (ADR 0011 'The app config').",
    )
