"""The api names a `path` source holds, read without compiling it, as the Node CLI's `workspace-api-names.ts`: the
`workspace.apis` of its `workspace.yaml`, or the `api.name` of its single api file. None when the file cannot be read
or parsed, or does not name them: the source is then compiled, and the compiler says what is wrong with it."""

import os
from typing import Final

from seampact.ir.config.config_tree import ConfigTree
from seampact.ir.config.json_value import JsonValue, object_of, string_of
from seampact.ir.config.yaml_reader import MAX_CONFIG_BYTES, parse_config_text

_WORKSPACE_ENTRY: Final = "workspace.yaml"
# A workspace with a single api may omit `workspace.yaml` (grammar section 1): its api file is then this one.
_SINGLE_API_ENTRY: Final = "api.yaml"


def workspace_api_names(directory: str) -> list[str] | None:
    for entry_name in (_WORKSPACE_ENTRY, _SINGLE_API_ENTRY):
        entry = os.path.join(directory, entry_name)

        if not os.path.exists(entry):
            continue

        if os.path.getsize(entry) > MAX_CONFIG_BYTES:
            return None

        try:
            with open(entry, encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            return None

        tree = parse_config_text(text, entry)

        if not isinstance(tree, ConfigTree):
            return None

        return _single_api_name(tree.value) if entry_name == _SINGLE_API_ENTRY else _workspace_apis(tree.value)

    return None


def _single_api_name(value: JsonValue) -> list[str] | None:
    name = string_of(object_of(value, "api"), "name")

    return None if name is None else [name]


def _workspace_apis(value: JsonValue) -> list[str] | None:
    apis = object_of(object_of(value, "workspace"), "apis")

    return None if apis is None else list(apis)
