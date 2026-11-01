"""The manifest rules no JSON Schema states: files strictly sorted by path in code-unit order, so no path is listed
twice; no two paths equal once folded to ASCII lower case; each api named once, its file `ir/<name>.json` and
listed; every `ir/` file an api's; packs sorted by name then version, none twice. The schema keeps every name ASCII,
so code-point order is code-unit order. Each problem reads `at '<pointer>' <problem>`."""

from seampact.ir.bundle.layout import IR_DIRECTORY
from seampact.ir.bundle.manifest import BundleManifest
from seampact.ir.bundle.path import fold, path_problem
from seampact.ir.bundle.text import quoted


def manifest_rule_problems(manifest: BundleManifest) -> list[str]:
    """Every rule a schema-valid manifest breaks, in manifest order."""
    return [*_file_problems(manifest), *_api_problems(manifest), *_pack_problems(manifest)]


def _at(pointer: str, message: str) -> str:
    return f"at {quoted(pointer)} {message}"


def _file_problems(manifest: BundleManifest) -> list[str]:
    problems: list[str] = []
    path_by_fold: dict[str, str] = {}

    for index, file in enumerate(manifest.files):
        pointer = f"/files/{index}/path"
        previous = manifest.files[index - 1].path if index > 0 else None
        unportable = path_problem(file.path)

        if unportable is not None:
            problems.append(_at(pointer, f"{quoted(file.path)} {unportable}"))

        if previous == file.path:
            problems.append(_at(pointer, f"'{file.path}' is listed twice"))
        elif previous is not None and previous > file.path:
            problems.append(_at(pointer, f"'{file.path}' is listed after '{previous}'; sort the files by path"))

        folded = fold(file.path)
        same_fold = path_by_fold.get(folded)

        if same_fold is not None and same_fold != file.path:
            problems.append(_at(pointer, f"'{file.path}' differs from '{same_fold}' only in letter case"))

        path_by_fold[folded] = file.path

    return problems


def _api_problems(manifest: BundleManifest) -> list[str]:
    problems: list[str] = []
    listed = {file.path for file in manifest.files}
    api_files: set[str] = set()
    names: set[str] = set()

    for index, api in enumerate(manifest.apis):
        expected_file = f"{IR_DIRECTORY}/{api.name}.json"

        if api.name in names:
            problems.append(_at(f"/apis/{index}/name", f"the api '{api.name}' is listed twice"))

        if api.file != expected_file:
            problems.append(
                _at(f"/apis/{index}/file", f"the file of api '{api.name}' is '{api.file}', not '{expected_file}'")
            )
        elif api.file not in listed:
            problems.append(_at(f"/apis/{index}/file", f"'{api.file}' is not in files"))

        names.add(api.name)
        api_files.add(api.file)

    for index, file in enumerate(manifest.files):
        if file.path.startswith(f"{IR_DIRECTORY}/") and file.path not in api_files:
            problems.append(_at(f"/files/{index}/path", f"'{file.path}' is not the file of any api"))

    return problems


def _pack_problems(manifest: BundleManifest) -> list[str]:
    problems: list[str] = []

    for index in range(1, len(manifest.packs)):
        previous = manifest.packs[index - 1]
        pack = manifest.packs[index]

        if (previous.name, previous.version) >= (pack.name, pack.version):
            problems.append(
                _at(
                    f"/packs/{index}",
                    f"the pack '{pack.name}@{pack.version}' is listed twice or out of order; "
                    "sort the packs by name then version",
                )
            )

    return problems
