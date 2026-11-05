"""Where a bundle comes from (ADR 0011 "Channels"), with the `integrity` the config pins; a missing pin fails the
check and prints the value to pin."""

from dataclasses import dataclass
from enum import StrEnum

from seampact.ir.https.printable_url import printable_url


class Registry(StrEnum):
    NPM = "package"
    MAVEN = "maven"


@dataclass(frozen=True, slots=True)
class ReleaseSource:
    """A release asset: the bundle tarball downloaded over HTTPS."""

    url: str
    integrity: str | None

    def describe(self) -> str:
        """The source as the config writes it, for messages, with no credential of its URL."""
        return f"release '{printable_url(self.url)}'"


@dataclass(frozen=True, slots=True)
class GitSource:
    """A git tag: the bundle directory of the tag's tree, fetched with the system `git`."""

    url: str
    tag: str
    directory: str | None
    integrity: str | None

    def describe(self) -> str:
        in_directory = "" if self.directory is None else f", directory '{self.directory}'"

        return f"git '{printable_url(self.url)}' tag '{self.tag}'{in_directory}"


@dataclass(frozen=True, slots=True)
class RegistrySource:
    """A bundle another ecosystem's registry serves: an npm `package` with its `version`, or a `maven` artefact. A
    Python build reads neither registry, so the fetcher refuses it by name."""

    registry: Registry
    name: str
    integrity: str | None

    def describe(self) -> str:
        return f"package '{self.name}'" if self.registry is Registry.NPM else f"Maven artefact '{self.name}'"


type BundleSource = ReleaseSource | GitSource | RegistrySource
