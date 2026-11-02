"""The suite's shared credentials (`credentials.json`, the file the suite sends them from)."""

import json

from seampact_consumer_suite.suite_files import suite_files


def credential_text(name: str) -> str:
    value = _all().get(name)

    if not isinstance(value, str):
        raise ValueError(f"credentials.json holds no text '{name}'")

    return value


def credential_number(name: str) -> int:
    value = _all().get(name)

    if not isinstance(value, int):
        raise ValueError(f"credentials.json holds no integer '{name}'")

    return value


def _all() -> dict[str, object]:
    path = suite_files().credentials

    try:
        with open(path, encoding="utf-8") as handle:
            credentials: dict[str, object] = json.load(handle)
    except OSError as unreadable:
        raise OSError(
            f"{path} cannot be read: the assemble script copies credentials.json into the app"
        ) from unreadable

    return credentials
