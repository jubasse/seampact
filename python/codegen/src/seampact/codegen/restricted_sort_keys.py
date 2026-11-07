"""A sort key restricted by a right, refused by name for every Python target: none checks the right on a sort."""

from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.model import Operation


def refuse_restricted_sort_keys(operation: Operation, at: IrPlace, refusals: Refusals) -> None:
    if operation.paging is None:
        return

    for position, sort_key in enumerate(operation.paging.sort_keys):
        if sort_key.right is not None:
            refusals.waiting(
                "paging.sortKey.right",
                f"The sort key '{sort_key.key}' restricted by the right '{sort_key.right}'",
                at.below("paging", "sortKeys", position),
                Delivery.CONSUMER,
            )
