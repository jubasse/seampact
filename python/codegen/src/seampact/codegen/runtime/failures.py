"""What stops a contract request before its handler's reply: a refusal answered with one of the api's codes, and a
failure of the boundary itself, answered with the api's 500; and how a log line names a failure."""

import traceback

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


def failure_place(failure: BaseException) -> str:
    """The exception's class and where it was raised; the boundary's own failures name no input and keep their
    message. Any other message may carry an input value, so it is left to the caller's debug mode."""
    if isinstance(failure, BoundaryFailureError):
        return str(failure)

    frames = traceback.extract_tb(failure.__traceback__)
    where = f"{frames[-1].filename}:{frames[-1].lineno}" if frames else "an unknown place"

    return f"{type(failure).__qualname__} raised at {where}"
