"""Targets discovered through the `seampact.generators` entry points of distributions installed into a temporary
venv, and the `seampact generate` and `check` run over a git-tag bundle."""

import io
import json
import sys
import sysconfig
import venv
from collections.abc import Callable, Iterator
from importlib import metadata
from pathlib import Path

import pytest

from seampact.ir.binary import DocumentsCommand
from seampact.ir.config import ConfigProblem
from seampact.ir.run import contract_apis, matrix_check, native_docs_document, runner
from seampact.ir.run.command import EXIT_PASSED, EXIT_REFUSED, EXIT_USAGE, run
from seampact.ir.run.discovery import InstalledTarget, discover_target
from seampact.ir.run.matrix_framework import MatrixFramework, MatrixTarget, VersionUnit

type GitRepositoryFactory = Callable[..., tuple[Path, dict[str, str]]]

_GOOD_MODULE = """
from seampact.ir.read import IrSupport
from seampact.ir.write import GeneratedFile


class GoodGenerator:
    def ir_support(self):
        return IrSupport.of_model(kinds=%s)

    def framework_docs_off_fix(self):
        return "Switch the framework's document off in the app."

    def generate(self, ir, entry):
        options = dict(entry.options)
        return [GeneratedFile("models.py", f"API = {ir.api.id!r}\\nOPTIONS = {options!r}\\n")]
"""
_WRONG_ITEMS_MODULE = """
from seampact.ir.read import IrSupport


class WrongItemsGenerator:
    def ir_support(self):
        return IrSupport.of_model(kinds=%s)

    def framework_docs_off_fix(self):
        return None

    def generate(self, ir, entry):
        return ["models.py"]
"""
_RECORDING_MODULE = """
from seampact.ir.read import IrSupport
from seampact.ir.write import GeneratedFile


class RecordingGenerator:
    def ir_support(self):
        return IrSupport.of_model(kinds=%s)

    def framework_docs_off_fix(self):
        return None

    def generate(self, ir, entry):
        accepted = entry.matrix.frameworks[0].accepted_units(entry.allow_untested)
        return [GeneratedFile("versions.py", f"ROW = {entry.matrix.use!r}\\nACCEPTED = {accepted!r}\\n")]
"""
_DOCS_MODULE = """
import json

from seampact.ir.read import IrSupport
from seampact.ir.write import GeneratedFile


class DocsGenerator:
    def ir_support(self):
        return IrSupport.of_model(kinds=%s)

    def framework_docs_off_fix(self):
        return None

    def generate(self, ir, entry):
        native = None if entry.native_docs is None else [entry.native_docs.name, entry.native_docs.document]
        return [GeneratedFile("docs.py", f"DOCS = {json.dumps([entry.framework_docs.value, native])!r}\\n")]
"""
_NOT_A_GENERATOR_MODULE = "class Plain:\n    pass\n"


def _install(site_packages: Path, name: str, version: str, entry_points: list[str], module: str | None) -> None:
    """A distribution as pip leaves it: a `.dist-info` directory and its module."""
    info = site_packages / f"{name.replace('-', '_')}-{version}.dist-info"
    info.mkdir()
    (info / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n", encoding="utf-8")

    if entry_points:
        (info / "entry_points.txt").write_text("[seampact.generators]\n" + "\n".join(entry_points) + "\n")

    if module is not None:
        (site_packages / f"{name.replace('-', '_')}.py").write_text(module, encoding="utf-8")


@pytest.fixture
def site_packages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, valid_bundle: tuple[dict[str, bytes], str]
) -> Iterator[Path]:
    """The site-packages of a fresh venv holding fake target distributions, on the import path."""
    environment = tmp_path / "venv"
    venv.create(environment, with_pip=False)
    site = Path(sysconfig.get_path("purelib", vars={"base": str(environment), "platbase": str(environment)}))
    site.mkdir(parents=True, exist_ok=True)
    kinds = json.loads(valid_bundle[0]["ir/t.json"])["kinds"]
    _install(site, "acme-good", "1.2.0", ["good = acme_good:GoodGenerator"], _GOOD_MODULE % kinds)
    _install(site, "acme-wrong", "1.0.0", ["wrong = acme_wrong:WrongItemsGenerator"], _WRONG_ITEMS_MODULE % kinds)
    _install(site, "acme-recording", "1.4.0", ["rec = acme_recording:RecordingGenerator"], _RECORDING_MODULE % kinds)
    _install(site, "acme-docs", "1.0.0", ["docs = acme_docs:DocsGenerator"], _DOCS_MODULE % kinds)
    _install(site, "acme-broken", "1.0.0", ["bad = acme_broken:Plain"], _NOT_A_GENERATOR_MODULE)
    _install(site, "acme-twice", "1.0.0", ["a = acme_twice:Plain", "b = acme_twice:Plain"], _NOT_A_GENERATOR_MODULE)
    _install(site, "acme-plain", "1.0.0", [], None)
    monkeypatch.syspath_prepend(str(site))
    yield site

    for name in [name for name in sys.modules if name.startswith("acme_")]:
        del sys.modules[name]


def _discover(use: str) -> InstalledTarget | ConfigProblem:
    return discover_target(use, "main", metadata.distributions())


def test_a_distribution_with_a_generator_entry_point_is_found_by_its_normalised_name(site_packages: Path) -> None:
    target = _discover("pypi:Acme_Good")

    assert isinstance(target, InstalledTarget)
    assert (target.distribution, target.version) == ("acme-good", "1.2.0")


@pytest.mark.parametrize(
    ("use", "code"),
    [
        ("pypi:acme-absent", "config.target.missing"),
        ("pypi:acme-plain", "config.target.not-a-target"),
        ("pypi:acme-broken", "config.target.load-failed"),
        ("pypi:acme-twice", "config.target.load-failed"),
    ],
)
def test_a_target_that_cannot_be_used_is_refused_by_name(site_packages: Path, use: str, code: str) -> None:
    target = _discover(use)

    assert isinstance(target, ConfigProblem)
    assert target.code == code


def _project(
    tmp_path: Path, repository: Path, pin: str, entry_extra: str = "", distribution: str = "acme-good"
) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "seampact.config.yaml").write_text(
        f"sources:\n  contract:\n    git: {{ url: {json.dumps(str(repository))}, tag: v1, directory: contract }}\n"
        f"    integrity: {pin}\nopenapi: none\ntargets:\n"
        f"  - {{ id: main, use: 'pypi:{distribution}', api: t, options: {{ flavour: plain }}{entry_extra} }}\n",
        encoding="utf-8",
    )

    return project


def _run(project: Path, environment: dict[str, str], *arguments: str) -> tuple[int, str, str]:
    stdout = io.StringIO()
    stderr = io.StringIO()
    code = run(arguments, str(project), environment, stdout, stderr)

    return code, stdout.getvalue(), stderr.getvalue()


def test_generate_writes_the_headed_files_and_check_reports_drift(
    site_packages: Path,
    tmp_path: Path,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    files, pin = valid_bundle
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", files)
    project = _project(tmp_path, repository, pin)
    environment = {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}
    models = project / "__generated__" / "main" / "models.py"

    code, stdout, stderr = _run(project, environment, "generate")

    assert (code, stderr) == (EXIT_PASSED, "")
    assert "entry 'main' wrote 1 file(s)" in stdout
    assert models.read_text(encoding="utf-8").splitlines() == [
        '# Generated by acme-good 1.2.0 from api "t". Do not edit.',
        "API = 't'",
        "OPTIONS = {'flavour': 'plain'}",
    ]
    assert _run(project, environment, "check")[0] == EXIT_PASSED

    models.write_text("edited\n", encoding="utf-8")
    drift_code, _, drift = _run(project, environment, "check")

    assert drift_code == EXIT_REFUSED
    assert "check.generated.drift" in drift
    assert _run(project, environment, "generate")[0] == EXIT_REFUSED
    assert _run(project, environment, "generate", "--force")[0] == EXIT_PASSED


def test_a_wrong_pin_stops_the_run_before_any_file_is_written(
    site_packages: Path,
    tmp_path: Path,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, "sha256-" + "A" * 43 + "=")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert code == EXIT_REFUSED
    assert "bundle.pin-mismatch" in stderr
    assert not (project / "__generated__").exists()


def test_a_target_distribution_that_is_not_installed_is_named(
    tmp_path: Path, git_repository: GitRepositoryFactory, valid_bundle: tuple[dict[str, bytes], str]
) -> None:
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, valid_bundle[1])

    code, _, stderr = _run(project, environment, "check")

    assert code == EXIT_REFUSED
    assert "config.target.missing" in stderr


def test_the_command_line_answers_help_and_refuses_misuse(tmp_path: Path) -> None:
    assert _run(tmp_path, {}, "--help")[0] == EXIT_PASSED
    assert "Usage: seampact generate" in _run(tmp_path, {}, "--help")[1]

    for arguments in ([], ["publish"], ["check", "--force"], ["generate", "--config"]):
        code, _, stderr = _run(tmp_path, {}, *arguments)

        assert code == EXIT_USAGE
        assert "Usage:" in stderr


def test_a_missing_config_is_refused_with_its_code(tmp_path: Path) -> None:
    code, _, stderr = _run(tmp_path, {}, "check")

    assert code == EXIT_REFUSED
    assert "config.file.missing" in stderr


def test_a_generator_returning_something_but_generated_files_is_named(
    site_packages: Path,
    tmp_path: Path,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, valid_bundle[1], distribution="acme-wrong")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert code == EXIT_REFUSED
    assert "config.target.generate-failed" in stderr
    assert "GeneratedFile" in stderr


def test_frameworkdocs_off_is_refused_with_the_fix_of_a_target_that_cannot_switch_it(
    site_packages: Path,
    tmp_path: Path,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, valid_bundle[1], ", frameworkDocs: off")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert code == EXIT_REFUSED
    assert "config.frameworkDocs.unsupported" in stderr
    assert "Switch the framework's document off in the app." in stderr
    assert not (project / "__generated__").exists()


def test_the_entry_hands_the_generator_its_matrix_row_and_allow_untested_items(
    site_packages: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    acme = MatrixFramework("acme", "acme-recording", VersionUnit.MAJOR, "1.0", ("1",), {})
    recorded = {"pypi:acme-recording": MatrixTarget("pypi:acme-recording", (acme,))}
    monkeypatch.setattr(matrix_check, "python_targets", lambda: recorded)
    monkeypatch.setattr(runner, "python_targets", lambda: recorded)
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, valid_bundle[1], ", allowUntested: [acme@2]", "acme-recording")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert (code, stderr) == (EXIT_PASSED, "")
    assert (project / "__generated__" / "main" / "versions.py").read_text(encoding="utf-8").splitlines()[1:] == [
        "ROW = 'pypi:acme-recording'",
        "ACCEPTED = ('1', '2')",
    ]


def _generated_docs(project: Path) -> object:
    line = (project / "__generated__" / "main" / "docs.py").read_text(encoding="utf-8").splitlines()[1]

    return json.loads(line.removeprefix("DOCS = ")[1:-1])


def test_the_entry_hands_the_generator_its_frameworkdocs_and_no_document_without_nativedocs(
    site_packages: Path,
    tmp_path: Path,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    project = _project(tmp_path, repository, valid_bundle[1], ", frameworkDocs: off", "acme-docs")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert (code, stderr) == (EXIT_PASSED, "")
    assert _generated_docs(project) == ["off", None]


def test_nativedocs_hands_the_generator_the_document_the_binary_emits_on_a_scratch_config(
    site_packages: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    git_repository: GitRepositoryFactory,
    valid_bundle: tuple[dict[str, bytes], str],
) -> None:
    scratch_configs: list[tuple[dict[str, dict[str, object]], list[str], object]] = []

    def emit(
        binary: object, config_file: str, command: object, bundles: dict[str, str], *_: object, **__: object
    ) -> None:
        config = json.loads(Path(config_file).read_text(encoding="utf-8"))
        scratch_configs.append((config, sorted(bundles), command))
        (Path(config_file).parent / "t.yaml").write_text("# headed\nopenapi: 3.1.0\npaths: {}\n", encoding="utf-8")

    monkeypatch.setattr(native_docs_document, "documents_with_binary", emit)
    monkeypatch.setattr(contract_apis.ContractApis, "binary", lambda self: object())
    (tmp_path / "git").mkdir()
    repository, environment = git_repository(tmp_path / "git", valid_bundle[0])
    extra = ", artefacts: { nativeDocs: true }"
    project = _project(tmp_path, repository, valid_bundle[1], extra, "acme-docs")

    code, _, stderr = _run(project, {**environment, "XDG_CACHE_HOME": str(tmp_path / "cache")}, "generate")

    assert (code, stderr) == (EXIT_PASSED, "")
    assert _generated_docs(project) == ["keep", [None, {"openapi": "3.1.0", "paths": {}}]]
    [(config, bundles, command)] = scratch_configs
    assert config["openapi"] == {"t": {"path": "t.yaml", "servers": []}}
    assert config["sources"] == {
        "contract": {
            "git": {"url": str(repository), "tag": "v1", "directory": "contract"},
            "integrity": valid_bundle[1],
        }
    }
    assert "targets" not in config
    assert (bundles, command) == (["contract"], DocumentsCommand.GENERATE)
