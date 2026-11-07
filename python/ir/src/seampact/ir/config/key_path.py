"""A key path into a config value, member names and array indexes, printed as the Node CLI prints it."""

from collections.abc import Sequence

type KeyPath = Sequence[str | int]


def format_key_path(path: KeyPath) -> str:
    """`targets[1].link.validators`."""
    text = ""

    for position, segment in enumerate(path):
        if isinstance(segment, int):
            text += f"[{segment}]"
        else:
            text += segment if position == 0 else f".{segment}"

    return text


def is_at_or_below(path: str, ancestor: str) -> bool:
    """Whether the formatted `path` is `ancestor` or below it."""
    return path == ancestor or is_below(path, ancestor)


def is_below(path: str, ancestor: str) -> bool:
    """Whether the formatted `path` is strictly below `ancestor`."""
    if path == ancestor:
        return False

    return ancestor == "" or path.startswith((f"{ancestor}.", f"{ancestor}["))
