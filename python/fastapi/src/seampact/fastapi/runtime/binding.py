"""`bind_api`, which each generated `bind_<api>()` calls last (ADR 0026 "Placement"): it includes the api's router
into the target with no prefix and keeps the entry it became for the boot check, registers the exception map, and adds
the boundary with `add_middleware`, so it is the outermost of `app.user_middleware`."""

from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.boundary import ContractBoundary
from seampact.fastapi.runtime.exception_map import register_exception_map


def bind_api(binding: ApiBinding) -> None:
    binding.target.include_router(binding.router)
    binding.route_entry = binding.target.routes[-1]
    register_exception_map(binding)
    binding.app.add_middleware(ContractBoundary, binding=binding)
