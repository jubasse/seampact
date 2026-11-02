"""What stops a contract request before its handler's reply: a refusal answered with one of the api's codes, and a
failure of the boundary itself, answered with the api's 500."""

from seampact.codegen.runtime.ir_view import IrMap


class ContractRefusal(Exception):  # noqa: N818 - a refusal is an answer, not an error of the app
    """A request the boundary answers with `code` of `api`, its params rendered from the code's role binding."""

    def __init__(self, api: str, code: str, params: IrMap | None = None) -> None:
        super().__init__(f"seampact: the '{api}' boundary refuses the request with '{code}'.")
        self.api = api
        self.code = code
        self.params = params


class BoundaryFailureError(RuntimeError):
    """A fault of the generated code or the handler that the boundary answers with the api's 500, logged with the
    cause."""
