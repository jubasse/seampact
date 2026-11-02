"""The DRF classes an app names per access kind (ADR 0027 "DRF"): `settings.SEAMPACT["<api>"]["access"]` maps an
access kind (`public`, `optional`, `identity`, `signed`) to DRF's own names (`authentication_classes`,
`permission_classes`, `throttle_classes`), each a list of dotted paths to classes. A contract view builds the classes
of its operation's kind, and none for a kind or a name the app left out, so the app's DRF defaults never apply to a
contract route. The boot check refuses a kind, a name or a path it cannot use, by name."""

from collections.abc import Mapping, Sequence
from typing import Final

from django.utils.module_loading import import_string
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.throttling import BaseThrottle

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_string
from seampact.django.runtime.api_settings import SETTINGS_NAME, SettingsError, api_settings

ACCESS_KEY: Final = "access"
AUTHENTICATION_CLASSES: Final = "authentication_classes"
PERMISSION_CLASSES: Final = "permission_classes"
THROTTLE_CLASSES: Final = "throttle_classes"
SIGNED_KIND: Final = "signed"
# The kinds of the PHP targets' native security layers: a signed identity never shares the classes of a signed-in
# caller's routes.
ACCESS_KINDS: Final = ("public", "optional", "identity", SIGNED_KIND)
_BASES: Final[Mapping[str, type]] = {
    AUTHENTICATION_CLASSES: BaseAuthentication,
    PERMISSION_CLASSES: BasePermission,
    THROTTLE_CLASSES: BaseThrottle,
}


def access_kind(contract: ApiContract, operation_id: str) -> str:
    """`public`, `optional` or `identity` from the operation's access, or `signed` when a signature verifies its
    identity."""
    access = ir_map(contract.operation(operation_id), "access")
    identity = ir_string(access, "identity")

    if identity is not None and ir_string(contract.declaration("identities", identity), "signed") is not None:
        return SIGNED_KIND

    return ir_string(access, "kind") or ""


def access_instances[B](contract: ApiContract, operation_id: str, name: str, base: type[B]) -> list[B]:
    """One instance of each class the app names under `name` for the operation's access kind; raises `SettingsError`
    for a value the boot check refuses, when the app turned the boot check off."""
    setting = _setting(contract.api)
    kinds = api_settings(contract.api).get(ACCESS_KEY, {})

    if not isinstance(kinds, Mapping):
        raise SettingsError(_not_a_mapping(setting, kinds))

    kind = access_kind(contract, operation_id)
    names = kinds.get(kind, {})

    if not isinstance(names, Mapping):
        raise SettingsError(_not_a_mapping(f"{setting}['{kind}']", names))

    return [imported() for imported in _classes(f"{setting}['{kind}']['{name}']", names.get(name, ()), base)]


def access_problems(contract: ApiContract, own: Mapping[str, object]) -> list[str]:
    """Every problem of the api's `access` setting: a value of the wrong type, an unknown kind or name, a kind no
    operation has, a path that does not import or names no class of DRF's matching base."""
    kinds = own.get(ACCESS_KEY)
    setting = _setting(contract.api)

    if kinds is None:
        return []

    if not isinstance(kinds, Mapping):
        return [_not_a_mapping(setting, kinds)]

    used = {access_kind(contract, operation_id) for operation_id in contract.operation_ids()}
    problems: list[str] = []

    for kind, names in kinds.items():
        if kind not in ACCESS_KINDS:
            problems.append(f"{setting} has the unknown access kind '{kind}'; the kinds are {', '.join(ACCESS_KINDS)}.")
        elif kind not in used:
            problems.append(f"{setting} names the access kind '{kind}', which no operation of the api has; remove it.")
        else:
            problems += _kind_problems(f"{setting}['{kind}']", names)

    return problems


def _kind_problems(setting: str, names: object) -> list[str]:
    if not isinstance(names, Mapping):
        return [_not_a_mapping(setting, names)]

    problems: list[str] = []

    for name, paths in names.items():
        base = _BASES.get(name)

        if base is None:
            problems.append(f"{setting} has the unknown key '{name}'; the keys are {', '.join(_BASES)}.")
            continue

        try:
            _classes(f"{setting}['{name}']", paths, base)
        except SettingsError as refused:
            problems.append(str(refused))

    return problems


def _classes[B](setting: str, paths: object, base: type[B]) -> list[type[B]]:
    if isinstance(paths, str) or not isinstance(paths, Sequence) or not all(isinstance(path, str) for path in paths):
        raise SettingsError(f"{setting} must be a list of dotted paths to {base.__name__} subclasses.")

    return [_imported_class(setting, path, base) for path in paths]


def _imported_class[B](setting: str, path: str, base: type[B]) -> type[B]:
    try:
        imported: object = import_string(path)
    except ImportError as missing:
        raise SettingsError(
            f"{setting} names '{path}', which does not import ({missing}); name a {base.__name__} subclass."
        ) from missing

    if not isinstance(imported, type) or not issubclass(imported, base):
        raise SettingsError(f"{setting} names '{path}', which is no {base.__name__} subclass; name one.")

    return imported


def _setting(api: str) -> str:
    return f"settings.{SETTINGS_NAME}['{api}']['{ACCESS_KEY}']"


def _not_a_mapping(setting: str, value: object) -> str:
    return f"{setting} is a {type(value).__name__}; set a dict."
