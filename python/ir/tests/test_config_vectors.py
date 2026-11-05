"""The `use` forms of a target entry from the shared vectors, and the YAML and key rules of the app config reader."""

import json
from pathlib import Path

import pytest

from seampact.ir.config import ConfigProblem, read_app_config
from seampact.ir.config.app_config import LocalSource
from seampact.ir.config.config_kind import ConfigKind
from seampact.ir.config.schema_check import schema_problems
from seampact.ir.config.target_ecosystem import TargetEcosystem
from seampact.ir.config.yaml_reader import parse_config_text

_VECTORS = "packages/core/spec/vectors/config/use-forms.json"
_OUT_DIRECTORY_VECTORS = "packages/core/spec/vectors/config/out-directories.json"
_ECOSYSTEMS = {
    "npm": TargetEcosystem.NPM,
    "maven": TargetEcosystem.MAVEN,
    "composer": TargetEcosystem.COMPOSER,
    "pypi": TargetEcosystem.PYPI,
}


def _vectors(repository_root: Path) -> dict[str, list[dict[str, str]]]:
    loaded: dict[str, list[dict[str, str]]] = json.loads((repository_root / _VECTORS).read_text(encoding="utf-8"))

    return loaded


def _config_using(use: str) -> str:
    return f"targets:\n  - id: main\n    use: {json.dumps(use)}\n    api: tasks\n"


def _problems_of(text: str) -> list[ConfigProblem]:
    tree = parse_config_text(text, "seampact.config.yaml")
    assert not isinstance(tree, list), tree

    return schema_problems(tree, ConfigKind.APP)


def test_every_accepted_use_passes_the_schema_with_its_ecosystem(repository_root: Path) -> None:
    accepted = _vectors(repository_root)["accepted"]
    assert accepted

    for vector in accepted:
        assert _problems_of(_config_using(vector["use"])) == [], vector["use"]
        assert TargetEcosystem.of(vector["use"]) is _ECOSYSTEMS[vector["ecosystem"]], vector["use"]


def test_every_refused_use_fails_the_schema_naming_the_use_rule(repository_root: Path) -> None:
    refused = _vectors(repository_root)["refused"]
    assert refused

    for vector in refused:
        problems = _problems_of(_config_using(vector["use"]))

        assert problems, vector["case"]
        assert all(problem.code == "config.schema" for problem in problems), vector["case"]


def test_a_refused_pypi_name_reads_the_pypi_rule(repository_root: Path) -> None:
    problems = _problems_of(_config_using("pypi:Seampact_FastAPI"))

    assert [problem.message for problem in problems if "PEP 503" in problem.message]


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("a: 1\n---\nb: 2\n", "config.yaml.syntax"),
        ("a: 1\na: 2\n", "config.yaml.syntax"),
        ("a: !custom 1\n", "config.yaml.tag"),
        ("a: !!str 5\n", "config.yaml.tag"),
        ("__proto__: 1\n", "config.key.reserved"),
        ("a: 9007199254740993\n", "config.yaml.integer-range"),
        ("a: [\n", "config.yaml.syntax"),
    ],
)
def test_the_yaml_reader_refuses_by_name(text: str, code: str) -> None:
    result = parse_config_text(text, "seampact.config.yaml")

    assert isinstance(result, list)
    assert [problem.code for problem in result] == [code]


def test_the_yaml_reader_refuses_an_alias_bomb() -> None:
    lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"]

    for level in range(1, 8):
        previous = chr(ord("a") + level - 1)
        lines.append(f"{chr(ord('a') + level)}: &{chr(ord('a') + level)} [{', '.join(['*' + previous] * 10)}]")

    result = parse_config_text("\n".join(lines) + "\n", "seampact.config.yaml")

    assert isinstance(result, list)
    assert "alias" in result[0].message.lower()


def test_the_yaml_reader_follows_the_core_schema_for_plain_scalars() -> None:
    result = parse_config_text(
        "date: 2026-10-26\nunderscore: 1_000\nbinary: 0b11\noctal: 0o17\nflag: true\nyes: yes\nnothing: ~\n"
        "ratio: 1.5\nquoted: '12'\n",
        "seampact.config.yaml",
    )

    assert not isinstance(result, list)
    assert result.value == {
        "date": "2026-10-26",
        "underscore": "1_000",
        "binary": "0b11",
        "octal": 15,
        "flag": True,
        "yes": "yes",
        "nothing": None,
        "ratio": 1.5,
        "quoted": "12",
    }


def _write_config(directory: Path, text: str) -> Path:
    file = directory / "seampact.config.yaml"
    file.write_text(text, encoding="utf-8")

    return file


def test_an_app_config_resolves_entries_sources_and_leaves_other_ecosystems(tmp_path: Path) -> None:
    file = _write_config(
        tmp_path,
        "outDir: gen\nsources:\n  contract: { path: ../contract }\ntargets:\n"
        "  - { id: main, use: 'pypi:seampact-fastapi', api: tasks }\n"
        "  - { id: web, use: '@seampact/codegen-express', api: tasks }\n",
    )

    config = read_app_config(str(file))

    assert not isinstance(config, list), config
    assert [entry.id for entry in config.entries] == ["main"]
    assert [entry.id for entry in config.other_entries] == ["web"]
    assert config.entries[0].root == f"{tmp_path}/gen/main"
    contract = config.sources["contract"]
    assert isinstance(contract, LocalSource)
    assert contract.directory == f"{tmp_path.parent}/contract"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (
            "targets:\n  - { id: a, use: 'pypi:x', api: t }\n  - { id: a, use: 'pypi:y', api: t, out: b }\n",
            "config.target.duplicate-id",
        ),
        ("targets:\n  - { id: a, use: 'pypi:x', api: t, out: ../elsewhere }\n", "config.out.outside"),
        (
            "targets:\n  - { id: a, use: 'pypi:x', api: t }\n  - { id: b, use: 'pypi:y', api: t, out: a/inner }\n",
            "config.out.overlap",
        ),
        ("targets:\n  - { id: a, use: 'pypi:x', api: t, access: { native: because } }\n", "config.key.waits"),
        ("targets:\n  - { id: a, use: 'pypi:x', api: t, nonsense: 1 }\n", "config.schema"),
        ("apps: [a]\n", "config.root.not-an-app"),
    ],
)
def test_an_app_config_is_refused_by_name(tmp_path: Path, body: str, code: str) -> None:
    config = read_app_config(str(_write_config(tmp_path, body)))

    assert isinstance(config, list)
    assert code in [problem.code for problem in config]


def test_out_directories_that_overlap_are_refused_by_their_code(repository_root: Path, tmp_path: Path) -> None:
    """The shared `out` vectors, which the Node, JVM and PHP readers pass too."""
    vectors = json.loads((repository_root / _OUT_DIRECTORY_VECTORS).read_text(encoding="utf-8"))["cases"]
    assert vectors

    for index, vector in enumerate(vectors):
        entries = "".join(
            f"  - {{ id: entry{position}, use: 'pypi:x', api: t, out: {json.dumps(out)} }}\n"
            for position, out in enumerate(vector["outs"])
        )
        directory = tmp_path / str(index)
        directory.mkdir()

        config = read_app_config(str(_write_config(directory, f"targets:\n{entries}")))
        refused_codes = [problem.code for problem in config] if isinstance(config, list) else []

        assert refused_codes == vector["codes"], vector["case"]


def test_an_app_listed_by_a_root_config_is_refused(tmp_path: Path) -> None:
    (tmp_path / "apps" / "api").mkdir(parents=True)
    _write_config(tmp_path, "apps: [apps/api]\n")
    file = _write_config(tmp_path / "apps" / "api", "targets:\n  - { id: a, use: 'pypi:x', api: t }\n")

    config = read_app_config(str(file))

    assert isinstance(config, list)
    assert [problem.code for problem in config] == ["config.root.unsupported"]


def test_a_missing_config_is_refused(tmp_path: Path) -> None:
    config = read_app_config(str(tmp_path / "seampact.config.yaml"))

    assert isinstance(config, list)
    assert config[0].code == "config.file.missing"
