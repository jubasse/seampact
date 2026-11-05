"""Prints every file a Python server target generates for a reference api, as JSON by path.

Run as a script by the tests that read a generated tree, so each run has its own interpreter: its own hash seed, time
zone and locale. Usage: `generated_tree.py <fastapi|drf|ninja> <repository root> <api> [crlf|reordered]`; the last
argument reads a copy of the contract with CRLF line endings, or with its keys in reverse order."""

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Final

from seampact.drf.generator import DrfGenerator
from seampact.fastapi.generator import FastApiGenerator
from seampact.ir.read import read_ir
from seampact.ir.run.generator import TargetEntry
from seampact.ir.run.matrix_framework import python_targets
from seampact.ir.write import GeneratedFile
from seampact.ninja.generator import NinjaGenerator

_GENERATORS: Final[dict[str, Callable[[], FastApiGenerator | DrfGenerator | NinjaGenerator]]] = {
    "fastapi": FastApiGenerator,
    "drf": DrfGenerator,
    "ninja": NinjaGenerator,
}
_COPIES: Final[dict[str, Callable[[str], str]]] = {
    "crlf": lambda text: text.replace("\n", "\r\n"),
    "reordered": lambda text: json.dumps(json.loads(text), indent=2, sort_keys=True, ensure_ascii=False) + "\n",
}


def generated_tree(target: str, repository_root: Path, api: str, copy: str | None) -> dict[str, str]:
    generator_class = _GENERATORS.get(target)

    if generator_class is None:
        raise SystemExit(f"unknown target {target!r}: expected one of {', '.join(_GENERATORS)}")

    text = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_bytes().decode("utf-8")

    if copy is not None:
        text = _COPIES[copy](text)

    use = f"pypi:seampact-{target}"
    entry = TargetEntry("reference", use, api, None, {}, {}, "/out", (), None, python_targets()[use], ())
    generator = generator_class()
    files: list[GeneratedFile] = list(generator.generate(read_ir(text, generator.ir_support()), entry))

    return {file.path: file.contents for file in files}


if __name__ == "__main__":
    copy_name = sys.argv[4] if len(sys.argv) > 4 else None
    print(json.dumps(generated_tree(sys.argv[1], Path(sys.argv[2]), sys.argv[3], copy_name), sort_keys=True))
