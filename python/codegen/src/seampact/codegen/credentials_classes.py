"""The credentials class of each security identity, shared by the Python targets: its name, its attribute per scheme
the kept operations read, and the frozen class itself, one `str | None` per scheme, hidden from `repr`. The authenticate
hook receives an instance; the runtime builds it through `CredentialsType`."""

from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.names import member_identifier
from seampact.codegen.printer import INDENT, string_literal
from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import ContractIR, IdentityAccess, OptionalAccess
from seampact.ir.naming import IrName, NameSource, NamingRole, python_identifier, segments_of

_REDACTED: Final = "[redacted]"
_CREDENTIALS_DOC: Final = (
    "The credentials a request presents for identity '{identity}', one per scheme, None when absent."
)

# How a generator claims a class name of its module: the name, what takes it, and where; it answers the name.
type ClaimName = Callable[[str, str, IrPlace], str]


@dataclass(frozen=True, slots=True)
class CredentialsNames:
    """The credentials class of one identity and its attribute per scheme, in scheme order."""

    class_name: str
    attributes: Mapping[str, str]


def identity_credentials(
    ir: ContractIR, kept_operations: Collection[str], claim: ClaimName, refusals: Refusals
) -> dict[str, CredentialsNames]:
    """Per identity the kept operations read, its credentials class and the schemes those operations read it through."""
    schemes_by_identity: dict[str, dict[str, IrPlace]] = {}

    for index, operation in enumerate(ir.operations):
        access = operation.access

        if operation.id in kept_operations and isinstance(access, IdentityAccess | OptionalAccess):
            at = IrPlace(f"/operations/{index}", operation.id).below("access")
            schemes = schemes_by_identity.setdefault(access.identity, {})
            schemes.update({scheme: at.below("schemes") for scheme in access.schemes if scheme not in schemes})

    credentials: dict[str, CredentialsNames] = {}

    for identity, schemes in sorted(schemes_by_identity.items()):
        segments = segments_of(identity, NameSource.NAME) or [identity]
        class_name = claim(
            python_identifier(IrName((*segments, "credentials"), NamingRole.SCHEMA)),
            f"the credentials of identity '{identity}'",
            IrPlace(f"/identities/{identity}"),
        )
        credentials[identity] = CredentialsNames(class_name, _scheme_attributes(identity, schemes, refusals))

    return credentials


def credentials_class(decorator: str, identity: str, names: CredentialsNames) -> list[str]:
    """The class block, under the generator's frozen dataclass `decorator` line."""
    lines = [decorator, f"class {names.class_name}:", f'{INDENT}"""{_CREDENTIALS_DOC.format(identity=identity)}"""']
    attributes = list(names.attributes.values())

    if not attributes:
        return lines

    members = [f"{INDENT}{attribute}: str | None = None" for attribute in attributes]
    rendered = ", ".join(f"{attribute}={_REDACTED}" for attribute in attributes)
    redacted_repr = [
        f"{INDENT}def __repr__(self) -> str:",
        f"{INDENT * 2}return {string_literal(f'{names.class_name}({rendered})')}",
    ]

    return [*lines, "", *members, "", *redacted_repr]


def _scheme_attributes(identity: str, schemes: Mapping[str, IrPlace], refusals: Refusals) -> dict[str, str]:
    attributes: dict[str, str] = {}

    for scheme, at in sorted(schemes.items()):
        attribute = member_identifier(scheme)

        if attribute is None:
            refusals.inconsistent("scheme.no-segment", f"The scheme '{scheme}' yields no name segment", at)
            continue

        if attribute in attributes.values():
            refusals.add(
                "name.collision",
                f"The credentials of identity '{identity}' would hold two schemes as '{attribute}'.",
                "Rename one of the schemes in the contract.",
                at,
            )
            continue

        attributes[scheme] = attribute

    return attributes
