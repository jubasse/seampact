"""The fact table of a generated page class: the paging style's fact name of each attribute, written by the generator
so the runtime never rebuilds a fact name from an attribute name."""

from collections.abc import Mapping
from typing import Final

from seampact.codegen.runtime.failures import BoundaryFailureError

# The class attribute of a generated page that holds its table, attribute name to fact name.
PAGE_FACTS: Final = "_FACTS"


def page_facts(operation_id: str, page: object, attributes: Mapping[str, object]) -> dict[str, object]:
    """The page's attribute values by fact name, read through its class's fact table.

    Raises `BoundaryFailureError` when the class has no table or an attribute is not in it."""
    table = getattr(type(page), PAGE_FACTS, None)

    if not isinstance(table, Mapping):
        raise BoundaryFailureError(
            f"seampact: the page of operation '{operation_id}' is a {type(page).__qualname__} without the fact table "
            f"'{PAGE_FACTS}' of a generated page class; return the generated page."
        )

    unknown = sorted(set(attributes) - set(table))

    if unknown:
        raise BoundaryFailureError(
            f"seampact: the page of operation '{operation_id}' has the attributes {unknown}, which its fact table "
            "does not name; generate the page class again."
        )

    return {str(table[attribute]): value for attribute, value in attributes.items()}
