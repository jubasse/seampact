"""The framework versions the boot check accepts: the installed unit against the units `generate` recorded."""

from importlib import metadata

from seampact.codegen.runtime.framework_versions import AcceptedFramework, VersionUnit, framework_version_problems


def test_an_installed_version_in_an_accepted_unit_passes() -> None:
    major = metadata.version("pydantic").split(".")[0]
    pydantic = AcceptedFramework(package="pydantic", unit=VersionUnit.MAJOR, accepted=(major,))

    assert framework_version_problems([pydantic], "tasks") == []


def test_a_minor_generate_did_not_accept_is_refused_by_name() -> None:
    installed = metadata.version("pytest")
    pytest = AcceptedFramework(package="pytest", unit=VersionUnit.MINOR, accepted=("0.1",))

    assert framework_version_problems([pytest], "tasks") == [
        f"pytest {installed} is installed, but the api 'tasks' was generated for pytest 0.1; install one of those, "
        "or run seampact generate again (with `allowUntested` for an untested minor)"
    ]


def test_a_missing_distribution_is_refused_by_name() -> None:
    absent = AcceptedFramework(package="seampact-absent-framework", unit=VersionUnit.MAJOR, accepted=("1",))

    assert framework_version_problems([absent], "tasks") == [
        "seampact-absent-framework is not installed; the api 'tasks' was generated for seampact-absent-framework 1"
    ]
