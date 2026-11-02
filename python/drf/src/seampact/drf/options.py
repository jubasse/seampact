"""The options and artefact switches of a DRF entry (ADR 0026 "Options and registration", ADR 0027 "Options and
registration"), each unknown key and each value the target does not take refused by name. Run-time defaults
(`responses`, `bodyValidation`, `frameworkEtag`, `catchAll`, the boot check's parts) go into the boundary's
declaration; `rules` shapes the serializers; `routeHelpers` decides the `routes` module."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.drf.serializer_fields import RulesMode
from seampact.ir.config.json_value import JsonValue

_HANDLERS: Final = "handlers"
_PER_RESOURCE: Final = "perResource"
_INDENT: Final = "indent"
_INDENT_SPACES: Final = 4
_NAMING_KEYS: Final = ("suffixes", "escape", "enumCase")
_LAYOUT: Final = "layout"
_KNOWN_OPTIONS: Final = (
    _HANDLERS,
    _INDENT,
    "rules",
    "responses",
    "bodyValidation",
    "frameworkEtag",
    "catchAll",
)
_ROUTE_HELPERS: Final = "routeHelpers"
_BOOT_CHECK: Final = "bootCheck"
_ACCESS_HOOKS: Final = "accessHooks"
_BOOT_CHECK_PARTS: Final = ("frameworkRoutes", "hooks")
_HOOKS_OFF: Final = "off"


class ResponsesMode(StrEnum):
    STRICT = "strict"
    WARN = "warn"


class FrameworkEtag(StrEnum):
    STRIP = "strip"
    KEEP = "keep"


@dataclass(frozen=True, slots=True)
class BootCheck:
    """The boot check, on unless `bootCheck: false`; its framework-route and hook parts each turned off alone."""

    enabled: bool = True
    framework_routes: bool = True
    hooks: bool = True


@dataclass(frozen=True, slots=True)
class DrfOptions:
    rules: RulesMode = RulesMode.NATIVE
    responses: ResponsesMode = ResponsesMode.STRICT
    body_validation: bool = False
    framework_etag: FrameworkEtag = FrameworkEtag.STRIP
    catch_all: bool = True
    route_helpers: bool = True
    boot_check: BootCheck = BootCheck()


def drf_options(options: Mapping[str, JsonValue], artefacts: Mapping[str, JsonValue], refusals: Refusals) -> DrfOptions:
    reader = _Reader(options, refusals)

    for key in options:
        if key in _NAMING_KEYS:
            reader.refuse(
                "options.naming.unsupported",
                key,
                f"The naming option '{key}' is not taken by the drf target: it names Python with the defaults of "
                "ADR 0007, which the shared naming vectors test.",
                f"Remove '{key}' from the target's `options`.",
            )
        elif key == _LAYOUT:
            reader.refuse(
                "options.layout.unsupported",
                key,
                "The option 'layout' is set; the drf target writes one package per api, the only layout it takes.",
                "Remove 'layout' from the target's `options`.",
            )
        elif key not in _KNOWN_OPTIONS:
            reader.refuse(
                "options.unknown",
                key,
                f"The option '{key}' is not one the drf target knows; it takes '{"', '".join(_KNOWN_OPTIONS)}'.",
                f"Remove '{key}' from the target's `options`.",
            )

    if options.get(_HANDLERS, _PER_RESOURCE) != _PER_RESOURCE:
        refusals.waiting(
            "options.handlers",
            f"The option 'handlers: {_shown(options[_HANDLERS])}'",
            _at(_HANDLERS),
            Delivery.CONSUMER,
        )

    if options.get(_INDENT, _INDENT_SPACES) != _INDENT_SPACES:
        refusals.waiting(
            "options.indent", f"The option 'indent: {_shown(options[_INDENT])}'", _at(_INDENT), Delivery.CONSUMER
        )

    return DrfOptions(
        rules=reader.choice("rules", RulesMode.NATIVE),
        responses=reader.choice("responses", ResponsesMode.STRICT),
        body_validation=reader.flag("bodyValidation", default=False),
        framework_etag=reader.choice("frameworkEtag", FrameworkEtag.STRIP),
        catch_all=reader.flag("catchAll", default=True),
        route_helpers=_artefacts(artefacts, refusals),
        boot_check=_boot_check(artefacts.get(_BOOT_CHECK, True), refusals),
    )


def _artefacts(artefacts: Mapping[str, JsonValue], refusals: Refusals) -> bool:
    """Refuses each switch the target does not take, and returns `routeHelpers`."""
    for key, value in artefacts.items():
        at = IrPlace(f"/artefacts/{key}")

        if key == _ACCESS_HOOKS and value is False:
            refusals.waiting(
                "artefacts.accessHooks", "Native access instead of hooks ('accessHooks: false')", at, Delivery.CONSUMER
            )
        elif key not in (_ROUTE_HELPERS, _BOOT_CHECK, _ACCESS_HOOKS) or not _is_switch(key, value):
            refusals.add(
                "artefacts.unknown",
                f"The artefact switch '{key}: {_shown(value)}' is not one the drf target takes.",
                f"Remove '{key}' from the entry's `artefacts`; the drf target takes '{_ROUTE_HELPERS}', "
                f"'{_BOOT_CHECK}' and '{_ACCESS_HOOKS}: true'.",
                at,
            )

    return artefacts.get(_ROUTE_HELPERS, True) is not False


def _is_switch(key: str, value: JsonValue) -> bool:
    if key == _BOOT_CHECK and isinstance(value, Mapping):
        return all(part in _BOOT_CHECK_PARTS for part in value)

    return isinstance(value, bool)


def _boot_check(value: JsonValue, refusals: Refusals) -> BootCheck:
    if not isinstance(value, Mapping):
        return BootCheck(enabled=value is not False)

    hooks = value.get("hooks", "on")

    if hooks not in ("on", _HOOKS_OFF):
        refusals.waiting(
            "artefacts.bootCheck.hooks",
            f"'bootCheck.hooks: {_shown(hooks)}'",
            IrPlace("/artefacts/bootCheck/hooks"),
            Delivery.CONSUMER,
        )

    return BootCheck(framework_routes=value.get("frameworkRoutes", True) is not False, hooks=hooks != _HOOKS_OFF)


class _Reader:
    def __init__(self, options: Mapping[str, JsonValue], refusals: Refusals) -> None:
        self._options = options
        self._refusals = refusals

    def refuse(self, code: str, key: str, message: str, fix: str) -> None:
        self._refusals.add(code, message, fix, _at(key))

    def choice[E: StrEnum](self, key: str, default: E) -> E:
        value = self._options.get(key, default.value)
        chosen = next((member for member in type(default) if member.value == value), None)

        if chosen is not None:
            return chosen

        allowed = "', '".join(member.value for member in type(default))
        self.refuse(
            f"options.{key}.invalid",
            key,
            f"The option '{key}' is {_shown(value)}, not one of '{allowed}'.",
            f"Set '{key}' to '{default.value}' (the default) or another listed value.",
        )
        return default

    def flag(self, key: str, default: bool) -> bool:
        value = self._options.get(key, default)

        if isinstance(value, bool):
            return value

        self.refuse(
            f"options.{key}.invalid",
            key,
            f"The option '{key}' is {_shown(value)}, not true or false.",
            f"Set '{key}' to true or false (the default is {json.dumps(default)}).",
        )
        return default


def _at(key: str) -> IrPlace:
    return IrPlace(f"/options/{key}")


def _shown(value: JsonValue) -> str:
    return json.dumps(value, ensure_ascii=False)
