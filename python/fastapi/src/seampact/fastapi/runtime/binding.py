"""`bind_api`, which each generated `bind_<api>()` calls last (ADR 0026 "Placement"): it includes the api's router
into the target with no prefix and keeps the entry it became for the boot check, registers the exception map, and adds
the boundary with `add_middleware`, so it is the outermost of `app.user_middleware`; then it switches FastAPI's own
document off or completes it with the contract routes, as the entry's `frameworkDocs` and `nativeDocs` ask."""

from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.boundary import ContractBoundary
from seampact.fastapi.runtime.exception_map import register_exception_map
from seampact.fastapi.runtime.framework_document import complete_framework_document, switch_framework_docs_off
from seampact.fastapi.runtime.native_docs import FrameworkDocs


def bind_api(binding: ApiBinding) -> None:
    binding.target.include_router(binding.router)
    binding.route_entry = binding.target.routes[-1]
    register_exception_map(binding)
    binding.app.add_middleware(ContractBoundary, binding=binding)

    if binding.placement.framework_docs is FrameworkDocs.OFF:
        switch_framework_docs_off(binding.app)

    if binding.placement.native_docs is not None:
        complete_framework_document(binding, binding.placement.native_docs)
