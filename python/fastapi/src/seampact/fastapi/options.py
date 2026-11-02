"""The options and artefact switches of a fastapi target entry (ADR 0026 "Options and registration" and "What the
shape-imposing features turn off with"), each unknown key or value outside its set refused by name: `handlers`
(`perResource` only), `indent` (the four spaces ruff writes), `rules`, and the run-time defaults `responses`,
`bodyValidation`, `frameworkEtag` and `catchAll`; the naming options and `layout` are refused. The artefacts are
`bootCheck`, `accessHooks` (`false` waits for a consumer), `routeHelpers` and `nativeDocs` (`true` waits for its
release)."""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from seampact.codegen.pydantic_models import RulesMode
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.runtime.reply_verdict import FrameworkEtagMode, ResponsesMode
from seampact.fastapi.runtime.placement import BootCheckSwitches, FrameworkRoutesCheck, HooksCheck, TargetDefaults
from seampact.ir.config.json_value import JsonValue

INDENT_SPACES: Final = 4
_HANDLERS: Final = "handlers"
_PER_RESOURCE: Final = "perResource"
_INDENT: Final = "indent"
_RULES: Final = "rules"
_RESPONSES: Final = "responses"
_BODY_VALIDATION: Final = "bodyValidation"
_FRAMEWORK_ETAG: Final = "frameworkEtag"
_CATCH_ALL: Final = "catchAll"
_LAYOUT: Final = "layout"
_NAMING_KEYS: Final = ("suffixes", "escape", "enumCase")
_KNOWN_KEYS: Final = (
    _HANDLERS,
    _INDENT,
    _RULES,
    _RESPONSES,
    _BODY_VALIDATION,
    _FRAMEWORK_ETAG,
    _CATCH_ALL,
    _LAYOUT,
    *_NAMING_KEYS,
)
_BOOT_CHECK: Final = "bootCheck"
_ACCESS_HOOKS: Final = "accessHooks"
_ROUTE_HELPERS: Final = "routeHelpers"
_NATIVE_DOCS: Final = "nativeDocs"
_ARTEFACTS: Final = (_BOOT_CHECK, _ACCESS_HOOKS, _ROUTE_HELPERS, _NATIVE_DOCS)
_STRICT_ROUTES: Final = "strict"
_HOOKS_WARN: Final = "warn"
_FRAMEWORK_ROUTES: Final = "frameworkRoutes"
_HOOKS: Final = "hooks"
_BOOT_CHECK_KEYS: Final = (_FRAMEWORK_ROUTES, _HOOKS)
_NATIVE_DOCS_RELEASE: Final = "fastapi-4"


@dataclass(frozen=True, slots=True)
class FastApiOptions:
    rules: RulesMode
    defaults: TargetDefaults
    boot_check: BootCheckSwitches
    route_helpers: bool


def read_options(
    options: Mapping[str, JsonValue], artefacts: Mapping[str, JsonValue], refusals: Refusals
) -> FastApiOptions:
    """The entry's options and artefacts; every refusal goes to `refusals`, and a refused value reads as its default."""
    values = _OptionValues(options, refusals)
    values.refuse_unknown()
    values.refuse_unsupported()

    return FastApiOptions(
        rules=values.choice(_RULES, RulesMode.NATIVE),
        defaults=TargetDefaults(
            responses=values.choice(_RESPONSES, ResponsesMode.STRICT),
            body_validation=values.flag(_BODY_VALIDATION, default=False),
            framework_etag=values.choice(_FRAMEWORK_ETAG, FrameworkEtagMode.STRIP),
            catch_all=values.flag(_CATCH_ALL, default=True),
        ),
        boot_check=_boot_check(artefacts.get(_BOOT_CHECK, True), refusals),
        route_helpers=_read_artefacts(artefacts, refusals),
    )


class _OptionValues:
    def __init__(self, options: Mapping[str, JsonValue], refusals: Refusals) -> None:
        self._options = options
        self._refusals = refusals

    def refuse_unknown(self) -> None:
        for key in self._options:
            if key not in _KNOWN_KEYS:
                self._refuse(
                    "options.unknown",
                    key,
                    f"The option '{key}' is not one the fastapi target knows; it takes "
                    f"'{"', '".join(_KNOWN_KEYS[:7])}'.",
                    f"Remove '{key}' from the target's `options`.",
                )

    def refuse_unsupported(self) -> None:
        handlers = self._options.get(_HANDLERS, _PER_RESOURCE)

        if handlers != _PER_RESOURCE:
            self._refuse(
                "options.handlers.unsupported",
                _HANDLERS,
                f"The option 'handlers' is {handlers!r}; the fastapi target groups operations per resource only (ADR "
                "0007 'perResource'), and 'perOperation' waits for an app that needs it.",
                "Set 'handlers' to 'perResource', or leave it out.",
            )

        indent = self._options.get(_INDENT, INDENT_SPACES)

        if indent != INDENT_SPACES or isinstance(indent, bool):
            self._refuse(
                "options.indent.unsupported",
                _INDENT,
                f"The option 'indent' is {indent!r}; the fastapi target writes the four spaces ruff formats with.",
                f"Set 'indent' to {INDENT_SPACES}, or leave it out.",
            )

        if _LAYOUT in self._options:
            self._refuse(
                "options.layout.unsupported",
                _LAYOUT,
                "The option 'layout' is set; the fastapi target writes one package per api, the only layout it takes.",
                "Remove 'layout' from the target's `options`.",
            )

        for key in _NAMING_KEYS:
            if key in self._options:
                self._refuse(
                    "options.naming.unsupported",
                    key,
                    f"The naming option '{key}' is not taken by the fastapi target yet: it names Python with the "
                    "defaults of ADR 0007, which the shared naming vectors test.",
                    f"Remove '{key}' from the target's `options`.",
                )

    def choice[E: StrEnum](self, key: str, default: E) -> E:
        value = self._options.get(key, default.value)

        for case in type(default):
            if case.value == value:
                return case

        allowed = "', '".join(case.value for case in type(default))
        self._refuse(
            f"options.{key}.invalid",
            key,
            f"The option '{key}' is {value!r}, not one of '{allowed}'.",
            f"Set '{key}' to '{default.value}' (the default) or another listed value.",
        )

        return default

    def flag(self, key: str, *, default: bool) -> bool:
        value = self._options.get(key, default)

        if isinstance(value, bool):
            return value

        self._refuse(
            f"options.{key}.invalid",
            key,
            f"The option '{key}' is {value!r}, not true or false.",
            f"Set '{key}' to true or false (the default is {str(default).lower()}).",
        )

        return default

    def _refuse(self, code: str, key: str, message: str, fix: str) -> None:
        self._refusals.add(code, message, fix, IrPlace(f"/options/{key}"))


def _boot_check(value: JsonValue, refusals: Refusals) -> BootCheckSwitches:
    """`bootCheck`: a boolean, or `{ frameworkRoutes, hooks }`; a value outside its set is refused and reads as the
    default."""
    at = IrPlace(f"/artefacts/{_BOOT_CHECK}")

    if not isinstance(value, Mapping):
        if not isinstance(value, bool):
            _refuse_boot_check_value(_BOOT_CHECK, value, "true, false or an object", at, refusals)

        enabled = value is not False
        on = FrameworkRoutesCheck.ON if enabled else FrameworkRoutesCheck.OFF

        return BootCheckSwitches(enabled=enabled, framework_routes=on, hooks=HooksCheck.ERROR)

    for key in value:
        if key not in _BOOT_CHECK_KEYS:
            _refuse_boot_check_value(f"{_BOOT_CHECK}.{key}", value[key], "absent", at.below(key), refusals)

    framework_routes = value.get(_FRAMEWORK_ROUTES, True)
    routes_check = _framework_routes_check(framework_routes)
    hooks = value.get(_HOOKS, HooksCheck.ERROR.value)
    hooks_check = HooksCheck.OFF if hooks == HooksCheck.OFF.value else HooksCheck.ERROR

    if routes_check is None:
        allowed = f"true, false or '{_STRICT_ROUTES}'"
        _refuse_boot_check_value(
            f"{_BOOT_CHECK}.{_FRAMEWORK_ROUTES}", framework_routes, allowed, at.below(_FRAMEWORK_ROUTES), refusals
        )

    if hooks not in (HooksCheck.ERROR.value, HooksCheck.OFF.value, _HOOKS_WARN):
        allowed = f"'{HooksCheck.ERROR.value}', '{HooksCheck.OFF.value}' or '{_HOOKS_WARN}'"
        _refuse_boot_check_value(f"{_BOOT_CHECK}.{_HOOKS}", hooks, allowed, at.below(_HOOKS), refusals)

    return BootCheckSwitches(enabled=True, framework_routes=routes_check or FrameworkRoutesCheck.ON, hooks=hooks_check)


def _framework_routes_check(value: JsonValue) -> FrameworkRoutesCheck | None:
    if value is True:
        return FrameworkRoutesCheck.ON

    if value is False:
        return FrameworkRoutesCheck.OFF

    return FrameworkRoutesCheck.STRICT if value == _STRICT_ROUTES else None


def _refuse_boot_check_value(name: str, value: JsonValue, allowed: str, at: IrPlace, refusals: Refusals) -> None:
    refusals.add(
        f"artefacts.{name}.invalid",
        f"The artefact '{name}' is {value!r}, not {allowed}.",
        f"Set '{name}' to one of the listed values, or remove it for its default.",
        at,
    )


def _read_artefacts(artefacts: Mapping[str, JsonValue], refusals: Refusals) -> bool:
    """Refuses the artefacts the target does not take yet; returns whether the route helpers are on."""
    for key, value in artefacts.items():
        at = IrPlace(f"/artefacts/{key}")

        if key not in _ARTEFACTS:
            refusals.add(
                "artefacts.unknown",
                f"The artefact '{key}' is not one the fastapi target declares; it takes '{"', '".join(_ARTEFACTS)}'.",
                f"Remove '{key}' from the entry's `artefacts`.",
                at,
            )
        elif key == _ACCESS_HOOKS and value is False:
            refusals.waiting("artefacts.accessHooks", "The artefact switch 'accessHooks: false'", at, Delivery.CONSUMER)
        elif key == _NATIVE_DOCS and value is True:
            refusals.add(
                "artefacts.nativeDocs.unsupported",
                "The artefact switch 'nativeDocs: true' is not generated by the fastapi target yet: it comes with "
                f"the {_NATIVE_DOCS_RELEASE} release of seampact-fastapi.",
                "Remove 'nativeDocs' from the entry's `artefacts`, or update seampact-fastapi to a release that "
                "generates it.",
                at,
            )
        elif key == _BOOT_CHECK and isinstance(value, Mapping) and value.get("hooks") == _HOOKS_WARN:
            refusals.waiting(
                "artefacts.bootCheck.hooks.warn",
                "'bootCheck.hooks: warn' (start with hooks missing)",
                at.below("hooks"),
                Delivery.CONSUMER,
            )

    return artefacts.get(_ROUTE_HELPERS, True) is not False
