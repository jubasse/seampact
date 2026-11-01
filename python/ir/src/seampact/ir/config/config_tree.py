"""A config value as JSON read from a YAML file, and the name of that file in problems. The YAML reader keeps key
paths and lines of its own problems only, so a schema problem names its file and key path."""

from dataclasses import dataclass

from seampact.ir.config.json_value import JsonValue
from seampact.ir.config.key_path import KeyPath, format_key_path


@dataclass(frozen=True, slots=True)
class ConfigTree:
    value: JsonValue
    display_name: str

    def where_of(self, path: KeyPath) -> str:
        """`<file> <key path>`."""
        return self.display_name if not path else f"{self.display_name} {format_key_path(path)}"
