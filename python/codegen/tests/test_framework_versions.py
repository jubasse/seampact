"""The framework versions the boot check accepts: the installed unit against the units `generate` recorded."""

from importlib import metadata

from seampact.codegen.runtime.framework_versions import (
    AcceptedFramework,
    VersionUnit,
    framework_version_problems,
    framework_version_warnings,
)


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


def test_a_minor_outside_the_tested_minors_of_its_major_is_only_warned_of() -> None:
    installed = metadata.version("pytest")
    major, minor = installed.split(".")[:2]
    untested = AcceptedFramework(
        package="pytest", unit=VersionUnit.MAJOR, accepted=(major,), tested_minors=(f"{major}.{int(minor) + 1}",)
    )
    tested = AcceptedFramework(
        package="pytest", unit=VersionUnit.MAJOR, accepted=(major,), tested_minors=(f"{major}.{minor}",)
    )

    assert framework_version_problems([untested], "tasks") == []
    assert framework_version_warnings([tested], "tasks") == []
    assert framework_version_warnings([untested], "tasks") == [
        f"pytest {installed} is installed, and the api 'tasks' is tested on pytest {major}.{int(minor) + 1} only, so "
        "this minor is untested; install a tested minor to serve on a tested version"
    ]
