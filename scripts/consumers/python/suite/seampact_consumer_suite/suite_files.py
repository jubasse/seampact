"""The files the suite doubles read and write, given by the app at startup since it knows where they live."""

from dataclasses import dataclass
from typing import Final

_UNCONFIGURED: Final = "configure_suite_files() was not called before the suite doubles ran."


@dataclass(frozen=True, slots=True)
class SuiteFiles:
    control_state: str
    credentials: str


_configured: list[SuiteFiles] = []


def configure_suite_files(files: SuiteFiles) -> None:
    _configured[:] = [files]


def suite_files() -> SuiteFiles:
    if not _configured:
        raise LookupError(_UNCONFIGURED)

    return _configured[0]
