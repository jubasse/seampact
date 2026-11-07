"""The runtime version guard (ADR 0025 "Version guards", G3): generated code is accepted at the same version or at the
same `major.minor` with an installed patch at or above the generator's; a pre-release matches only itself."""

import pytest

from seampact.codegen.runtime.version import (
    GENERATED_FOR_OTHER_VERSION,
    RUNTIME_VERSION,
    RuntimeVersionError,
    accepts,
    other_version_problem,
    refuse_other_version,
)


@pytest.mark.parametrize(
    ("generated_by", "installed", "accepted"),
    [
        ("1.2.3", "1.2.3", True),
        ("1.2.3", "1.2.5", True),
        ("1.2.5", "1.2.3", False),
        ("1.2.3", "1.3.0", False),
        ("1.2.3", "2.2.3", False),
        ("1.2.3-rc.1", "1.2.3-rc.1", True),
        ("1.2.3-rc.1", "1.2.3", False),
        ("1.2.3", "1.2.3-rc.1", False),
        ("1.2.3-rc.1", "1.2.3-rc.2", False),
        ("1.2.3-rc.1", "1.2.4", False),
        ("1.2.3", "1.2.4-rc.1", False),
        ("0.0.0-development", "0.0.0-development", True),
        ("not-a-version", "not-a-version", True),
        ("not-a-version", "1.2.3", False),
        ("1.2.3", "not-a-version", False),
        ("1.2", "1.2.3", False),
        ("1.2.3.4", "1.2.3", False),
        ("", "1.2.3", False),
    ],
)
def test_the_guard_accepts_the_same_version_or_a_later_patch_of_the_same_minor_only(
    generated_by: str, installed: str, accepted: bool
) -> None:
    assert accepts(generated_by, installed) is accepted


def test_the_installed_runtime_accepts_code_generated_for_itself() -> None:
    assert accepts(RUNTIME_VERSION)
    assert other_version_problem("tasks", RUNTIME_VERSION) is None


def test_the_problem_names_both_versions_the_api_and_the_fix() -> None:
    problem = other_version_problem("tasks", "1.2.5", "1.3.0")

    assert problem is not None
    assert problem.startswith(f"seampact {GENERATED_FOR_OTHER_VERSION}: ")
    assert "'tasks'" in problem
    assert "seampact 1.2.5" in problem
    assert "installed runtime is 1.3.0" in problem
    assert "generator at 1.3.0" in problem
    assert "runtime at 1.2.5 or a later patch" in problem


def test_refusing_another_version_raises_the_boot_problem_and_accepting_one_returns() -> None:
    refuse_other_version("tasks", "1.2.3", "1.2.4")

    with pytest.raises(RuntimeVersionError, match=r"installed runtime is 1\.2\.2") as refused:
        refuse_other_version("tasks", "1.2.3", "1.2.2")

    assert refused.value.code == GENERATED_FOR_OTHER_VERSION
