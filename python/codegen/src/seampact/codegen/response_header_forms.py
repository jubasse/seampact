"""The response headers of the kept operations no Python boundary can write, refused by name for every target alike:
a derived header the runtime's entries refuse (a successor in another api, an `ETag` whose `If-Match` writes the api
does not serve, an inconsistent IR), and a paging style's header written from an object or an array, which has no
header text."""

from typing import Final

from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.runtime.ir_view import ir_maps
from seampact.codegen.runtime.response_header_entries import HeaderProblem, ProblemKind, response_header_entry
from seampact.ir.model import ContractIR, LiteralTemplate, SlotTemplate, Template, TextTemplate

# The page slots whose whole value is an object or an array: only a member of them is header text.
_STRUCTURED_PAGE_SLOTS: Final = frozenset({"items", "meta"})


def refuse_response_header_forms(ir: ContractIR, refusals: Refusals) -> None:
    """Refuses by name each response header of the kept operations the boundary cannot write."""
    operations = ir_maps(ir.to_json(), "operations")
    read_styles: set[str] = set()

    for index, operation in enumerate(operations):
        at = IrPlace(f"/operations/{index}", ir.operations[index].id)

        for position, response in enumerate(ir_maps(operation, "responses")):
            for header_position, header in enumerate(ir_maps(response, "headers")):
                entry = response_header_entry(ir.api.id, "", operations, operation, header)

                if isinstance(entry, HeaderProblem):
                    _refuse(entry, at.below("responses", position, "headers", header_position), refusals)

        paging = ir.operations[index].paging
        style_id = None if paging is None else paging.style

        if style_id is not None and style_id not in read_styles:
            read_styles.add(style_id)
            _refuse_structured_page_headers(ir, style_id, refusals)


def _refuse(problem: HeaderProblem, at: IrPlace, refusals: Refusals) -> None:
    if problem.kind is ProblemKind.WAITING:
        refusals.waiting(problem.code, problem.description, at, Delivery.AFTER_V1)
    else:
        refusals.inconsistent(problem.code, problem.description, at)


def _refuse_structured_page_headers(ir: ContractIR, style_id: str, refusals: Refusals) -> None:
    style = ir.pagings.get(style_id)

    if style is None:
        return

    for index, header in enumerate(style.response.headers):
        if not _is_scalar_template(header.value):
            refusals.waiting(
                "paging.response.header",
                f"The header '{header.name}' of the paging style '{style_id}', written from an object or an array,",
                IrPlace(f"/pagings/{style_id}/response/headers/{index}/value"),
                Delivery.AFTER_V1,
            )


def _is_scalar_template(template: Template) -> bool:
    if isinstance(template, TextTemplate):
        return True

    if isinstance(template, LiteralTemplate):
        return not isinstance(template.value, dict | list)

    if isinstance(template, SlotTemplate):
        return bool(template.path) or template.slot not in _STRUCTURED_PAGE_SLOTS

    return False
