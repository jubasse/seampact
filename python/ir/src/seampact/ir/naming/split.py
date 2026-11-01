"""Splitting a written name into segments (ADR 0007 section 2)."""

from enum import Enum, auto

from seampact.ir.naming.name import NameSource


class _CharacterKind(Enum):
    OTHER = auto()
    LOWER = auto()
    UPPER = auto()
    DIGIT = auto()


def _kind_of(character: str) -> _CharacterKind:
    if "a" <= character <= "z":
        return _CharacterKind.LOWER

    if "A" <= character <= "Z":
        return _CharacterKind.UPPER

    if "0" <= character <= "9":
        return _CharacterKind.DIGIT

    return _CharacterKind.OTHER


def _starts_segment(written: str, index: int) -> bool:
    """An uppercase letter after a lowercase letter or a digit starts a segment; so does one that ends an uppercase
    run and is followed by a lowercase letter (`HTTPServer`)."""
    previous = _kind_of(written[index - 1])
    following = _kind_of(written[index + 1]) if index + 1 < len(written) else _CharacterKind.OTHER

    if previous in (_CharacterKind.LOWER, _CharacterKind.DIGIT):
        return True

    return previous is _CharacterKind.UPPER and following is _CharacterKind.LOWER


def split_name(written: str) -> list[str]:
    """The four rules of ADR 0007 section 2. Total: any string gives a possibly empty list of non-empty
    `[a-z0-9]+` segments. Only ASCII letters and digits are looked at, so the result never depends on a locale."""
    segments: list[str] = []
    start = -1

    for index, character in enumerate(written):
        kind = _kind_of(character)

        if kind is _CharacterKind.OTHER:
            if start >= 0:
                segments.append(written[start:index].lower())
            start = -1
            continue

        if start < 0:
            start = index
            continue

        if kind is _CharacterKind.UPPER and _starts_segment(written, index):
            segments.append(written[start:index].lower())
            start = index

    if start >= 0:
        segments.append(written[start:].lower())

    return segments


def segments_of(
    written: str, source: NameSource, code_name: str | None = None, position: int | None = None
) -> list[str] | None:
    """The segments of a written name in its context (ADR 0007 section 2, last paragraph), or `None` when it has
    none (`no-segment`): a `code_name` replaces the split of `written` and never falls back; an enum value without
    a segment becomes `value<position>`, `position` being one-based and required for an enum value.

    Raises `ValueError` for an enum value without a positive position.
    """
    if source is NameSource.ENUM_VALUE and (position is None or position < 1):
        raise ValueError(f"an enum value needs its one-based position, got {'none' if position is None else position}")

    split = split_name(written if code_name is None else code_name)

    if split:
        return split

    if source is NameSource.ENUM_VALUE and code_name is None:
        return [f"value{position}"]

    return None
