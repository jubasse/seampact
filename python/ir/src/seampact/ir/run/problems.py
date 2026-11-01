"""Every refusal of a run as one shape, the config problem's (code, message, fix, where), so a run prints them alike
and the codes stay those of the Node CLI and the `seampact-ir` readers."""

from seampact.ir.binary.failure import BinaryFailure
from seampact.ir.bundle.failure import BundleFailure
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.read.refusal import IrRefusal
from seampact.ir.write.refusal import WriterRefusal


def problem_of_bundle(failure: BundleFailure, source: str) -> ConfigProblem:
    values = [
        value
        for value in (
            None if failure.expected is None else f"expected {failure.expected}",
            None if failure.actual is None else f"actual {failure.actual}",
        )
        if value is not None
    ]
    detail = f" ({', '.join(values)})" if values else ""
    file = "" if failure.file is None else f" {failure.file}"

    return ConfigProblem(failure.code.value, failure.message + detail, failure.fix, f"source '{source}'{file}")


def problem_of_binary(failure: BinaryFailure, where: str) -> ConfigProblem:
    return ConfigProblem(failure.code.value, failure.message, failure.fix, where)


def problem_of_writer(refusal: WriterRefusal, where: str) -> ConfigProblem:
    return ConfigProblem(refusal.code, refusal.message, refusal.fix, where)


def problem_of_ir(refusal: IrRefusal, use: str, where: str) -> ConfigProblem:
    return ConfigProblem(
        refusal.code.value,
        refusal.message,
        f"Use a contract this release of {use} reads, or update {use}.",
        f"{where} {refusal.member}",
    )
