"""The `settings` module of one api (ADR 0027 "Settings"): the typed shape of `settings.SEAMPACT["<api>"]`, whose
keys mirror `bind_<api>()`'s arguments, hooks and handler factories given as dotted paths, and `SETTINGS_KEYS`, the
keys the boot check accepts. A target adds its own keys (DRF's `access`); an annotation may use the module's
`_abc` (`collections.abc`) and `_typing` aliases."""

from collections.abc import Sequence
from dataclasses import dataclass

from seampact.codegen.printer import INDENT, PythonModule, string_literal

_RESPONSES_MODES = '_typing.Literal["strict", "warn"]'
_DOTTED_PATHS_BY_NAME = "_abc.Mapping[str, str]"


@dataclass(frozen=True, slots=True)
class SettingsKey:
    name: str
    annotation: str


_SHARED_KEYS = (
    SettingsKey("authenticate", _DOTTED_PATHS_BY_NAME),
    SettingsKey("deciders", _DOTTED_PATHS_BY_NAME),
    SettingsKey("scope_resolvers", _DOTTED_PATHS_BY_NAME),
    SettingsKey("idempotency_store", "str"),
    SettingsKey("on_unexpected_error", "str"),
    SettingsKey("responses", _RESPONSES_MODES),
    SettingsKey("body_validation", "bool"),
    SettingsKey("public_origin", "str"),
)


def settings_module(api: str, api_class: str, handler_owners: Sequence[str], target_keys: Sequence[SettingsKey]) -> str:
    """`handler_owners` are the attribute names of the api's handler groups, one factory each."""
    module = PythonModule(f"The settings of api '{api}', read from settings.SEAMPACT[\"{api}\"].")
    typing = module.imported("typing", "_typing")
    module.imported("collections.abc", "_abc")
    operations = SettingsKey("operations", f"_abc.Mapping[str, {api_class}OperationSettings]")
    keys = [
        SettingsKey("handlers", f"{typing}.Required[{api_class}HandlerSettings]"),
        *_SHARED_KEYS,
        operations,
        *target_keys,
    ]

    module.add_block(
        [
            f"class {api_class}HandlerSettings({typing}.TypedDict):",
            f'{INDENT}"""The dotted path of each handler factory, which builds the handlers from the HttpRequest."""',
            "",
            *(f"{INDENT}{owner}: str" for owner in handler_owners),
        ]
    )
    module.add_block(
        [
            f"class {api_class}OperationSettings({typing}.TypedDict, total=False):",
            f'{INDENT}"""What one operation sets over the api\'s settings."""',
            "",
            f"{INDENT}responses: {_RESPONSES_MODES}",
        ]
    )
    module.add_block(
        [
            f"class {api_class}Settings({typing}.TypedDict, total=False):",
            f'{INDENT}"""The value of settings.SEAMPACT["{api}"]."""',
            "",
            *(f"{INDENT}{key.name}: {key.annotation}" for key in keys),
        ]
    )
    module.add_block(
        [
            f"SETTINGS_KEYS: {typing}.Final = (",
            *(f"{INDENT}{string_literal(key.name)}," for key in keys),
            ")",
        ]
    )

    return module.text()
