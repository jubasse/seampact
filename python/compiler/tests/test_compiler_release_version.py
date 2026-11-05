"""The version check of a release build: the compiler and the `compiler` extra of seampact-ir at one version, and a
call that names its release version."""

import re
from pathlib import Path

import pytest

from release_version import ReleaseVersionError, release_version


def _checkout(root: Path, compiler_version: str, extra_requirement: str) -> Path:
    (root / "python" / "compiler").mkdir(parents=True)
    (root / "python" / "ir").mkdir(parents=True)
    (root / "python" / "compiler" / "pyproject.toml").write_text(
        f'[project]\nname = "seampact-compiler"\nversion = "{compiler_version}"\n', encoding="utf-8"
    )
    (root / "python" / "ir" / "pyproject.toml").write_text(
        f'[project]\nname = "seampact-ir"\nversion = "{compiler_version}"\n\n'
        f'[project.optional-dependencies]\ncompiler = ["{extra_requirement}"]\n',
        encoding="utf-8",
    )

    return root


def test_a_build_outside_a_call_carries_the_checkout_version(tmp_path: Path) -> None:
    assert release_version(_checkout(tmp_path, "0.0.0", "seampact-compiler==0.0.0"), None) == "0.0.0"


def test_a_call_at_the_stamped_version_carries_it(tmp_path: Path) -> None:
    assert release_version(_checkout(tmp_path, "1.2.0", "seampact-compiler==1.2.0"), "1.2.0") == "1.2.0"


def test_a_call_on_an_unstamped_compiler_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ReleaseVersionError, match=re.escape("is at 0.0.0")):
        release_version(_checkout(tmp_path, "0.0.0", "seampact-compiler==0.0.0"), "1.2.0")


def test_a_call_with_an_empty_version_is_refused_by_name(tmp_path: Path) -> None:
    with pytest.raises(ReleaseVersionError, match="`version` input is empty"):
        release_version(_checkout(tmp_path, "0.0.0", "seampact-compiler==0.0.0"), "")


def test_an_extra_at_another_version_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ReleaseVersionError, match=re.escape("pins seampact-compiler 0.0.0")):
        release_version(_checkout(tmp_path, "1.2.0", "seampact-compiler==0.0.0"), "1.2.0")


def test_an_extra_without_a_compiler_pin_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ReleaseVersionError, match="no single"):
        release_version(_checkout(tmp_path, "1.2.0", "seampact-compiler>=1.2.0"), "1.2.0")
