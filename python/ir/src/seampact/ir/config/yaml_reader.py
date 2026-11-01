"""One `seampact.config.yaml` read under YAML 1.2 (the core schema the Node CLI and the JVM plugins read) through
`ruamel.yaml`'s parser and composer, with the Node CLI's rules (ADR 0011 "The app config"): one document, unique
keys, the names that reach a JavaScript object's prototype refused, a tag refused by name, an integer past 2^53 - 1
refused, and an alias that expands past a budget refused, so a config every runner reads, it reads the same or
refuses by name. Plain scalars are resolved here by the core schema, not by `ruamel.yaml`'s own resolver, which
reads dates, underscored and binary numbers that the core schema reads as text."""

import os
import re
from typing import Final

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError
from ruamel.yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode

from seampact.ir.config.config_kind import ConfigKind
from seampact.ir.config.config_tree import ConfigTree
from seampact.ir.config.javascript_number import SAFE_INTEGER_MAX, integral_float_as_integer, javascript_number_text
from seampact.ir.config.json_value import JsonObject, JsonValue
from seampact.ir.config.key_path import KeyPath
from seampact.ir.config.problem import ConfigProblem

# The config is trusted (A46), but a stray huge file is refused before it is parsed.
MAX_CONFIG_BYTES: Final = 1024 * 1024
# Aliases share their anchored value; past this many values read again through an alias the file is an alias bomb.
_ALIAS_EXPANDED_VALUES_MAX: Final = 100_000
_RESERVED_KEYS: Final = ("__proto__", "constructor", "prototype")
_BYTE_ORDER_MARK: Final = "﻿"
_SYNTAX_FIX: Final = "Correct the YAML at that position."
_KEY_NULL: Final = "null"
_KEY_BOOLEAN: Final = "boolean"
_KEY_NUMBER: Final = "number"
_KEY_TEXT: Final = "text"

# A map key as YAML compares it (its kind and the text of the object member it names).
type _KeyIdentity = tuple[str, str]

_NULLS: Final = ("", "~", "null", "Null", "NULL")
_TRUES: Final = ("true", "True", "TRUE")
_FALSES: Final = ("false", "False", "FALSE")
_DECIMAL_INTEGER: Final = re.compile(r"[-+]?[0-9]+\Z")
_OCTAL_INTEGER: Final = re.compile(r"0o[0-7]+\Z")
_HEX_INTEGER: Final = re.compile(r"0x[0-9a-fA-F]+\Z")
_FLOAT: Final = re.compile(r"[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?\Z")
_INFINITY: Final = re.compile(r"([-+]?)\.(?:inf|Inf|INF)\Z")
_NOT_A_NUMBER: Final = (".nan", ".NaN", ".NAN")
_TAG_PREFIX: Final = "tag:yaml.org,2002:"


class _AliasBudgetExceededError(Exception):
    pass


def read_config_file(file: str, display_name: str, kind: ConfigKind) -> ConfigTree | list[ConfigProblem]:
    """The file's tree, or the problems refusing it."""
    if not os.path.isfile(file):
        fix = (
            "Create `seampact.config.yaml` in the app's directory, or pass its path with `--config`."
            if kind is ConfigKind.APP
            else "Pass the path of the monorepo root's `seampact.config.yaml`, the one holding `apps`."
        )

        return [ConfigProblem("config.file.missing", f"No {kind.title} at {display_name}.", fix)]

    size = os.path.getsize(file)

    if size > MAX_CONFIG_BYTES:
        return [
            ConfigProblem(
                "config.file.too-large",
                f"{display_name} holds {size} bytes, over the {MAX_CONFIG_BYTES} bytes {kind.articled} may hold.",
                f"Pass the path of the {kind.title} itself.",
            )
        ]

    try:
        with open(file, "rb") as handle:
            data = handle.read()
    except OSError:
        return [
            ConfigProblem(
                "config.file.unreadable",
                f"{display_name} cannot be read.",
                "Check that the file is readable by this user.",
            )
        ]

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return [
            ConfigProblem("config.yaml.syntax", "The file is not UTF-8 text.", "Save the file as UTF-8.", display_name)
        ]

    return parse_config_text(text, display_name)


def parse_config_text(text: str, display_name: str) -> ConfigTree | list[ConfigProblem]:
    """`text` as a config tree, or the problems refusing it."""
    text = text.removeprefix(_BYTE_ORDER_MARK)
    parser = YAML(typ="safe", pure=True)
    parser.version = (1, 2)

    try:
        root = parser.compose(text)
    except YAMLError as error:
        line = getattr(getattr(error, "problem_mark", None), "line", None)
        at = f":{line + 1}" if isinstance(line, int) else ""
        problem = getattr(error, "problem", None) or str(error)

        return [ConfigProblem("config.yaml.syntax", _sentence(str(problem)), _SYNTAX_FIX, display_name + at)]
    except RecursionError:
        return [ConfigProblem("config.yaml.syntax", "The YAML is nested too deep.", _SYNTAX_FIX, display_name)]

    converter = _Converter(parser, display_name)

    try:
        value = converter.convert(root, [])
    except _AliasBudgetExceededError:
        return [converter.syntax_problem("Excessive alias count indicates a resource exhaustion attack.", [])]
    except RecursionError:
        return [converter.syntax_problem("The YAML is nested too deep.", [])]

    return ConfigTree(value, display_name) if not converter.problems else converter.problems


class _Converter:
    def __init__(self, parser: YAML, display_name: str) -> None:
        self._parser = parser
        self._tree = ConfigTree(None, display_name)
        self._alias_expanded = 0
        self._alias_depth = 0
        self._seen: set[int] = set()
        self.problems: list[ConfigProblem] = []

    def convert(self, node: Node | None, path: list[str | int]) -> JsonValue:
        """A fresh copy of the composed value, so no two keys share one object through an alias. A node met a second
        time is an alias, and every value under it counts against the budget."""
        if node is None:
            return None

        met_before = id(node) in self._seen
        self._seen.add(id(node))
        self._alias_depth += int(met_before)

        try:
            self._count_alias_expansion()

            return self._convert_node(node, path)
        finally:
            self._alias_depth -= int(met_before)

    def _count_alias_expansion(self) -> None:
        if self._alias_depth == 0:
            return

        self._alias_expanded += 1

        if self._alias_expanded > _ALIAS_EXPANDED_VALUES_MAX:
            raise _AliasBudgetExceededError

    def _convert_node(self, node: Node, path: list[str | int]) -> JsonValue:

        if self._has_explicit_tag(node):
            self.problems.append(
                ConfigProblem(
                    "config.yaml.tag",
                    f"The tag '{node.tag}' is not read; a config holds plain YAML values.",
                    "Remove the tag, and quote the value when it must stay text.",
                    self._tree.where_of(path),
                )
            )

            return None

        if isinstance(node, ScalarNode):
            return self._scalar(node, path)

        if isinstance(node, SequenceNode):
            return [self.convert(item, [*path, index]) for index, item in enumerate(node.value)]

        if isinstance(node, MappingNode):
            return self._mapping(node, path)

        raise TypeError(f"seampact-ir: the YAML node {type(node).__name__} is not a scalar, sequence or mapping.")

    def syntax_problem(self, message: str, path: KeyPath) -> ConfigProblem:
        return ConfigProblem("config.yaml.syntax", message, _SYNTAX_FIX, self._tree.where_of(path))

    def _has_explicit_tag(self, node: Node) -> bool:
        """A node whose tag differs from the one the document's own text gives it carries an explicit tag."""
        if isinstance(node, ScalarNode):
            plain = node.style is None
            implicit = (plain, not plain)
            expected = self._parser.resolver.resolve(ScalarNode, node.value, implicit)
        else:
            expected = self._parser.resolver.resolve(type(node), None, (True, False))

        return bool(node.tag != expected)

    def _scalar(self, node: ScalarNode, path: list[str | int]) -> JsonValue:
        text = str(node.value)

        if node.style is not None:
            return text

        return self._plain_scalar(text, path)

    def _plain_scalar(self, text: str, path: list[str | int]) -> JsonValue:
        if text in _NULLS:
            return None

        if text in _TRUES:
            return True

        if text in _FALSES:
            return False

        integer = _integer_of(text)

        if integer is not None:
            return self._safe_integer(integer, text, path)

        return _float_of(text)

    def _safe_integer(self, integer: int, text: str, path: list[str | int]) -> int | None:
        if abs(integer) <= SAFE_INTEGER_MAX:
            return integer

        self.problems.append(
            ConfigProblem(
                "config.yaml.integer-range",
                f"'{text}' is an integer past 2^53 - 1: the Node CLI rounds it, this runner keeps it.",
                "Quote the value to keep the digits as text.",
                self._tree.where_of(path),
            )
        )

        return None

    def _mapping(self, node: MappingNode, path: list[str | int]) -> JsonObject:
        members: JsonObject = {}
        identities: set[_KeyIdentity] = set()

        for key_node, member_node in node.value:
            if not isinstance(key_node, ScalarNode):
                self.problems.append(self.syntax_problem("A mapping key must be a single value.", path))

                continue

            identity = self._key_identity(key_node, path)
            _, key = identity

            if key in _RESERVED_KEYS:
                self.problems.append(
                    ConfigProblem(
                        "config.key.reserved",
                        f"The key '{key}' is reserved: it would reach a JavaScript object's prototype.",
                        "Rename or remove the key.",
                        self._tree.where_of([*path, key]),
                    )
                )

                continue

            if identity in identities:
                self.problems.append(
                    self.syntax_problem(f"Map keys must be unique; '{key}' is repeated.", [*path, key])
                )

                continue

            identities.add(identity)
            members[key] = self.convert(member_node, [*path, key])

        return members

    def _key_identity(self, key_node: ScalarNode, path: list[str | int]) -> _KeyIdentity:
        """The key as the YAML reads it: a quoted key is text, a plain one is its resolved value, so `1` and `1.0`
        are one key and `1` and `"1"` are two that name the same object member."""
        text = str(key_node.value)

        if key_node.style is not None:
            return (_KEY_TEXT, text)

        value = self._plain_scalar(text, path)

        if value is None:
            return (_KEY_NULL, "")

        if isinstance(value, bool):
            return (_KEY_BOOLEAN, "true" if value else "false")

        if isinstance(value, (int, float)):
            return (_KEY_NUMBER, javascript_number_text(value))

        return (_KEY_TEXT, str(value))


def _integer_of(text: str) -> int | None:
    if _DECIMAL_INTEGER.match(text):
        return int(text)

    if _OCTAL_INTEGER.match(text):
        return int(text[2:], 8)

    if _HEX_INTEGER.match(text):
        return int(text[2:], 16)

    return None


def _float_of(text: str) -> int | float | str:
    if _FLOAT.match(text):
        return integral_float_as_integer(float(text))

    infinity = _INFINITY.match(text)

    if infinity:
        return float(f"{infinity.group(1)}inf")

    return float("nan") if text in _NOT_A_NUMBER else text


def _sentence(text: str) -> str:
    first_line = text.strip().split("\n")[0].strip()
    capitalized = first_line[:1].upper() + first_line[1:]

    return capitalized if capitalized.endswith(".") else f"{capitalized}."
