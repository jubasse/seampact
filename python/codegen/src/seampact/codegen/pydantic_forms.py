"""The contract forms the Pydantic targets, FastAPI and Ninja, do not generate yet (ADR 0026 "Refused by name or
waiting"), each refused by name: a body other than JSON, a binary or redirect response, native access, a page fact other
than those the page class carries, and a sort key restricted by a right. The forms no Python target serves are refused
by `seampact.codegen.kept_forms`, and unions and other schema forms by the shared Pydantic emitter."""

from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.restricted_sort_keys import refuse_restricted_sort_keys
from seampact.ir.model import (
    ContractIR,
    IdentityAccess,
    InputMediaType,
    OptionalAccess,
    PublicAccess,
    ResponseShape,
)

_SERVED_SHAPES = frozenset(
    {ResponseShape.ITEM, ResponseShape.TABLE, ResponseShape.LIST, ResponseShape.PAGE, ResponseShape.EMPTY}
)


def refuse_unserved_forms(ir: ContractIR, refusals: Refusals) -> None:
    for index, operation in enumerate(ir.operations):
        at = IrPlace(f"/operations/{index}", operation.id)

        if operation.input is not None and operation.input.media is not InputMediaType.APPLICATION_JSON:
            refusals.waiting(
                "input.media",
                f"A '{operation.input.media}' request body",
                at.below("input", "media"),
                Delivery.CONSUMER,
            )

        for position, response in enumerate(operation.responses):
            if isinstance(response.shape, ResponseShape) and response.shape not in _SERVED_SHAPES:
                refusals.waiting(
                    f"response.{response.shape.value}",
                    f"A '{response.shape.value}' response",
                    at.below("responses", position, "shape"),
                    Delivery.CONSUMER,
                )
            elif not isinstance(response.shape, ResponseShape):
                refusals.unknown_value(response.shape.raw, at.below("responses", position, "shape"))

        if not isinstance(operation.access, IdentityAccess | OptionalAccess | PublicAccess):
            refusals.waiting(
                f"access.{operation.access.kind}",
                f"The access kind '{operation.access.kind}'",
                at.below("access"),
                Delivery.CONSUMER,
            )

        refuse_restricted_sort_keys(operation, at, refusals)
