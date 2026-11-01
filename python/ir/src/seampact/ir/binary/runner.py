"""Runs `compile --config <app config> --out <directory>` of the private binary copy through `subprocess.run` with an
argument list and no shell, from the app config's directory, with the contract's environment only. Every path is made
absolute before any check, so the child, which starts in another directory, gets the files checked. The output
directory is a fresh one created owner-only in the system temporary directory; only the `<api>.ir.json` of each api
asked for is read from it, then it is removed. Standard input is the null device; the diagnostics are on standard
error. Exits 1 (refused) and 2 (a usage error) are refused as `binary.compile-refused` with the binary's diagnostics."""

import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from seampact.ir.binary.absolute_path import is_absolute, resolved
from seampact.ir.binary.child_environment import child_environment
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.installed_binary import InstalledBinary

_EXIT_COMPILED: Final = 0
_EXIT_REFUSED: Final = 1
_EXIT_USAGE: Final = 2

# The deadline of a compile.
DEADLINE_SECONDS: Final = 120.0
# Each output stream is kept up to this many bytes; the rest is counted.
_DIAGNOSTICS_BYTES_MAX: Final = 1024 * 1024
_OUTPUT_PREFIX: Final = "seampact-compile-"
_IR_SUFFIX: Final = ".ir.json"
# The api names of the app config schema: never a path separator or a `..`.
_API_NAME_PATTERN: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]*\Z")
_CONTROL_CHARACTERS: Final = re.compile("[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]")


@dataclass(frozen=True, slots=True)
class CompileOutput:
    """A compile that exited with 0: the IR text of each api, read with the reader by the caller with its own
    support, and the binary's diagnostics (warnings), with control characters other than newline and tab removed.
    Exits 1 and 2 are refused (`binary.compile-refused`), never returned."""

    diagnostics: str
    ir_text_by_api: Mapping[str, str]


def compile_with_binary(
    binary: InstalledBinary,
    config_file: str,
    apis: Sequence[str],
    parent_environment: Mapping[str, str],
    *,
    windows: bool,
    timeout_seconds: float = DEADLINE_SECONDS,
) -> CompileOutput:
    """`apis` are the apis of the app config, whose IR files are read. Raises `BinaryRefusedError`
    (`binary.cache-unsafe`, `binary.hash-mismatch`, `binary.compile-refused`, `binary.compile-timeout` or
    `binary.compile-failed`)."""
    _refuse_unsafe_api_names(apis)
    config_file = resolved(config_file)

    if not is_absolute(binary.path):
        raise _failed(f"path '{binary.path}' is relative, so the file checked and the file started could differ", "")

    binary.refuse_unless_intact()
    output_directory = _new_output_directory()

    try:
        exit_code, _, diagnostics = _run(
            [binary.path, "compile", "--config", config_file, "--out", output_directory],
            os.path.dirname(config_file),
            child_environment(parent_environment, windows=windows),
            timeout_seconds,
            output_directory,
        )

        return _output(exit_code, diagnostics, output_directory, apis)
    finally:
        shutil.rmtree(output_directory, ignore_errors=True)


def _output(exit_code: int, diagnostics: str, output_directory: str, apis: Sequence[str]) -> CompileOutput:
    if exit_code < 0:
        raise _failed(f"was stopped by the signal {-exit_code}", diagnostics)

    if exit_code in (_EXIT_REFUSED, _EXIT_USAGE):
        raise BinaryRefusedError(
            BinaryFailureCode.COMPILE_REFUSED,
            f"The compiler binary refused the compile with the exit code {exit_code}. Its diagnostics:\n{diagnostics}",
            "Fix what the diagnostics name in the app config or the contract, then run the compile again.",
        )

    if exit_code != _EXIT_COMPILED:
        raise _failed(f"exited with the code {exit_code}", diagnostics)

    ir_text_by_api: dict[str, str] = {}

    for api in apis:
        file = os.path.join(output_directory, f"{api}{_IR_SUFFIX}")

        if not os.path.isfile(file) or os.path.islink(file):
            raise _failed(f"exited with 0 and wrote no IR for the api '{api}' ({api}{_IR_SUFFIX})", diagnostics)

        with open(file, encoding="utf-8", newline="") as handle:
            ir_text_by_api[api] = handle.read()

    return CompileOutput(diagnostics, ir_text_by_api)


def _run(
    command: list[str], directory: str, environment: dict[str, str], timeout_seconds: float, scratch_directory: str
) -> tuple[int, str, str]:
    """Standard output and error go to private files in the output directory, read once the child exits, so a chatty
    binary fills a file, not this process's memory. Returns the exit code (negative: a signal), standard output and
    standard error."""
    stdout_file = os.path.join(scratch_directory, ".stdout")
    stderr_file = os.path.join(scratch_directory, ".stderr")

    try:
        with open(stdout_file, "wb") as stdout, open(stderr_file, "wb") as stderr:
            completed = subprocess.run(
                command,
                cwd=directory,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
                shell=False,
                timeout=timeout_seconds,
                check=False,
            )
    except subprocess.TimeoutExpired as error:
        raise BinaryRefusedError(
            BinaryFailureCode.COMPILE_TIMEOUT,
            f"The compiler binary ran past its deadline of {timeout_seconds} s and was stopped.",
            "Run the compile again; if it hangs again, report it with the contract that makes it hang.",
        ) from error
    except OSError as error:
        raise _failed(f"did not start ({error})", "") from error

    return completed.returncode, _stream_text(stdout_file), _stream_text(stderr_file)


def _stream_text(stream_file: str) -> str:
    size = os.path.getsize(stream_file)

    with open(stream_file, "rb") as handle:
        kept = handle.read(_DIAGNOSTICS_BYTES_MAX)

    shown = _CONTROL_CHARACTERS.sub("", kept.decode("utf-8", errors="replace"))
    dropped = size - _DIAGNOSTICS_BYTES_MAX

    return f"{shown}\n[{dropped} more bytes of diagnostics not shown]\n" if dropped > 0 else shown


def _refuse_unsafe_api_names(apis: Sequence[str]) -> None:
    for api in apis:
        if _API_NAME_PATTERN.match(api) is None:
            raise ValueError(
                f"The api name '{api}' is not an api name of the app config schema (a letter, then letters, digits, "
                "`_` or `-`); its IR file is never read."
            )


def _new_output_directory() -> str:
    """Below the system temporary directory, made absolute: a relative TMPDIR is resolved once here. `mkdtemp`
    creates it owner-only."""
    try:
        return tempfile.mkdtemp(prefix=_OUTPUT_PREFIX, dir=resolved(tempfile.gettempdir()))
    except OSError as error:
        raise _failed(f"could not be given an output directory ({error})", "") from error


def _failed(what: str, diagnostics: str) -> BinaryRefusedError:
    tail = "" if diagnostics == "" else f" Its diagnostics:\n{diagnostics}"

    return BinaryRefusedError(
        BinaryFailureCode.COMPILE_FAILED,
        f"The compiler binary {what}.{tail}",
        "Run the compile again; if it fails again, check that the binary is a seampact compiler build for this "
        "platform.",
    )
