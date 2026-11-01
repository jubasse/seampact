"""The app config of a Python build (ADR 0011 "The app config"): the YAML read, the schema check, the entry view."""

from seampact.ir.config.app_config import AppConfig, AppConfigEntry, LocalSource
from seampact.ir.config.entry_view import EntryViewResult, SourceApi, entry_view
from seampact.ir.config.problem import ConfigProblem, problems_text
from seampact.ir.config.reader import CONFIG_FILE_NAME, read_app_config

__all__ = [
    "CONFIG_FILE_NAME",
    "AppConfig",
    "AppConfigEntry",
    "ConfigProblem",
    "EntryViewResult",
    "LocalSource",
    "SourceApi",
    "entry_view",
    "problems_text",
    "read_app_config",
]
