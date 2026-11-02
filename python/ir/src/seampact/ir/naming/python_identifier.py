"""The Python identifier of a name (ADR 0007 sections 4 and 5): Pascal case for types, snake case for operations and
members, upper snake case for enum members; a leading `_` before a digit, except on a member, which takes `field_`
since Pydantic keeps a `_` name as a private attribute; then a trailing `_` on a reserved or shadowed name."""

from typing import Final

from seampact.ir.naming.name import IrName, NamingRole
from seampact.ir.naming.python_reserved import python_reserved_words

_DIGIT_ESCAPE: Final = "_"
_MEMBER_DIGIT_PREFIX: Final = "field_"
_RESERVED_ESCAPE: Final = "_"
_SNAKE_ROLES: Final = frozenset({NamingRole.OPERATION, NamingRole.MEMBER})


def python_identifier(name: IrName) -> str:
    """Raises `ValueError` for a name without any word."""
    words = name.words()

    if not words:
        raise ValueError(f"a {name.role.value} name without segment has no identifier")

    identifier = _joined(words, name.role)

    if identifier[0].isdigit():
        identifier = (_MEMBER_DIGIT_PREFIX if name.role is NamingRole.MEMBER else _DIGIT_ESCAPE) + identifier

    if python_reserved_words().reserves(identifier, name.role):
        identifier += _RESERVED_ESCAPE

    return identifier


def _joined(words: tuple[str, ...], role: NamingRole) -> str:
    if role is NamingRole.ENUM_MEMBER:
        return "_".join(word.upper() for word in words)

    if role in _SNAKE_ROLES:
        return "_".join(words)

    # Words are `[a-z0-9]+`: a leading digit has no upper case and stays as it is.
    return "".join(word[0].upper() + word[1:] for word in words)
