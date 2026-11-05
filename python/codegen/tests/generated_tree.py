"""Prints every file a Python server target generates for a reference api, as JSON by path.

Run as a script by the tests that read a generated tree, so each run has its own interpreter: its own hash seed, time
zone and locale. Usage: `generated_tree.py <fastapi|drf|ninja> <repository root> <api>`."""

import json
import sys
from pathlib import Path

from seampact.drf.generator import DrfGenerator
from seampact.fastapi.generator import FastApiGenerator
from seampact.ir.read import read_ir
from seampact.ir.run.generator import TargetEntry
from seampact.ir.run.matrix_framework import python_targets
from seampact.ninja.generator import NinjaGenerator


def generated_tree(target: str, repository_root: Path, api: str) -> dict[str, str]:
    text = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")
    use = f"pypi:seampact-{target}"
    entry = TargetEntry("reference", use, api, None, {}, {}, "/out", (), None, python_targets()[use], ())

    if target == "fastapi":
        fastapi = FastApiGenerator()

        return {file.path: file.contents for file in fastapi.generate(read_ir(text, fastapi.ir_support()), entry)}

    if target == "drf":
        drf = DrfGenerator()

        return {file.path: file.contents for file in drf.generate(read_ir(text, drf.ir_support()), entry)}

    if target == "ninja":
        ninja = NinjaGenerator()

        return {file.path: file.contents for file in ninja.generate(read_ir(text, ninja.ir_support()), entry)}

    raise SystemExit(f"unknown target {target!r}: expected fastapi, drf or ninja")


if __name__ == "__main__":
    print(json.dumps(generated_tree(sys.argv[1], Path(sys.argv[2]), sys.argv[3]), sort_keys=True))
