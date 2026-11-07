"""The two kinds of `seampact.config.yaml` (ADR 0011 "The app config"): an app's, or a monorepo root's."""

from enum import Enum


class ConfigKind(Enum):
    APP = ("app config", "app.schema.json")
    ROOT = ("root config", "root.schema.json")

    def __init__(self, title: str, schema_file: str) -> None:
        self.title = title
        self.schema_file = schema_file

    @property
    def articled(self) -> str:
        return f"a {self.title}"
