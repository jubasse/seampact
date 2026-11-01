"""An app config as the Python runner reads it. `entries` are the entries of this runner's ecosystem (PyPI
distributions); `other_entries` those another runner generates, kept so a run can name them, never generated here.
The `openapi`, `checks` and `warnings` members are copies, as the config writes them, None when it does not."""

from dataclasses import dataclass

from seampact.ir.bundle.source import BundleSource
from seampact.ir.config.json_value import (
    JsonObject,
    JsonValue,
    has,
    object_copy_of,
    object_of,
    string_of,
    strings_of,
)
from seampact.ir.config.target_ecosystem import TargetEcosystem


@dataclass(frozen=True, slots=True)
class LocalSource:
    """A `path` source: a contract workspace on disk, its absolute directory, compiled by the pinned binary."""

    directory: str


@dataclass(frozen=True, slots=True)
class AppConfigEntry:
    """One target entry with its absolute output root, `<outDir>/<out>`. `entry` is the entry as the config writes
    it, a copy; the typed members are read from it."""

    entry: JsonObject
    root: str

    @property
    def id(self) -> str:
        return string_of(self.entry, "id") or ""

    @property
    def use(self) -> str:
        return string_of(self.entry, "use") or ""

    @property
    def ecosystem(self) -> TargetEcosystem:
        return TargetEcosystem.of(self.use)

    @property
    def api_refs(self) -> list[str]:
        """The entry's `api`, or each of its `apis`: an api name alone, or `<source>/<api>`."""
        apis = strings_of(self.entry, "apis")

        if apis is not None:
            return apis

        api = string_of(self.entry, "api")

        return [] if api is None else [api]

    @property
    def names_several_apis(self) -> bool:
        """Whether the entry names several apis with `apis`, each generated under `<out>/<api>`."""
        return has(self.entry, "apis")

    @property
    def document(self) -> str | None:
        return string_of(self.entry, "document")

    @property
    def include(self) -> list[str]:
        return strings_of(object_of(self.entry, "operations"), "include") or []

    @property
    def exclude(self) -> list[str]:
        return strings_of(object_of(self.entry, "operations"), "exclude") or []

    @property
    def options(self) -> JsonObject:
        """The entry's `options`, a copy, empty when absent."""
        return object_copy_of(object_of(self.entry, "options"))

    @property
    def artefacts(self) -> JsonObject:
        """The entry's `artefacts`, a copy, empty when absent."""
        return object_copy_of(object_of(self.entry, "artefacts"))


@dataclass(frozen=True, slots=True)
class AppConfig:
    display_name: str
    file: str
    directory: str
    out_dir: str
    allow_local: bool | None
    sources: dict[str, LocalSource | BundleSource]
    entries: list[AppConfigEntry]
    other_entries: list[AppConfigEntry]
    openapi: JsonValue
    checks: JsonObject | None
    warnings: JsonObject | None
