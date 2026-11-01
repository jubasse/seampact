"""The cache rules on injected file facts: the POSIX owner and mode rules up to the filesystem root, the Windows
reparse-point and ACL rule up to the user profile, and the refusal of a PowerShell output of another shape."""

import pytest

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.posix_cache_safety import PathFact, PosixCacheSafety
from seampact.ir.binary.windows_cache_safety import WindowsCacheSafety
from seampact.ir.binary.windows_path_facts import WindowsPathFact, facts_of_output

_USER = 1000
_OTHER_USER = 1001
_ROOT = 0
_PROCESS_GROUP = 1000
_SHARED_GROUP = 100

_COPY = "/home/dev/.cache/composer/seampact/abc/seampact"
_HASH_DIRECTORY = "/home/dev/.cache/composer/seampact/abc"
_CACHE_ROOT = "/home/dev/.cache/composer/seampact"


class _FakePosixFacts:
    def __init__(self, facts: dict[str, PathFact]) -> None:
        self._facts = facts

    def of(self, path: str) -> PathFact | None:
        return self._facts.get(path)

    def current_uid(self) -> int:
        return _USER

    def current_gid(self) -> int:
        return _PROCESS_GROUP


def _private(group: int = _SHARED_GROUP, mode: int = 0o700) -> PathFact:
    return PathFact(False, _USER, group, mode)


_POSIX_CASES: dict[str, tuple[dict[str, PathFact], str | None]] = {
    "a private cache under a home directory": ({}, None),
    "a copy owned by another user": ({_COPY: PathFact(False, _OTHER_USER, _SHARED_GROUP, 0o700)}, _COPY),
    "a link as the hash directory": ({_HASH_DIRECTORY: PathFact(True, _USER, _SHARED_GROUP, 0o777)}, _HASH_DIRECTORY),
    "a cache root its shared group may write": ({_CACHE_ROOT: _private(mode=0o770)}, _CACHE_ROOT),
    "a cache root the process group may write": ({_CACHE_ROOT: _private(_PROCESS_GROUP, 0o775)}, _CACHE_ROOT),
    "a hash directory others may write": ({_HASH_DIRECTORY: _private(_PROCESS_GROUP, 0o777)}, _HASH_DIRECTORY),
    "a copy the process group may write": ({_COPY: _private(_PROCESS_GROUP, 0o770)}, _COPY),
    "a link above the real cache root": (
        {"/home/dev/.cache": PathFact(True, _USER, _SHARED_GROUP, 0o777)},
        "/home/dev/.cache",
    ),
    "an ancestor the process group may write": ({"/home/dev": _private(_PROCESS_GROUP, 0o775)}, None),
    "a root-owned ancestor the process group may write": (
        {"/home": PathFact(False, _ROOT, _PROCESS_GROUP, 0o775)},
        None,
    ),
    "an ancestor others may write": ({"/home/dev": _private(_PROCESS_GROUP, 0o777)}, "/home/dev"),
    "an ancestor another group may write": ({"/home/dev": _private(_SHARED_GROUP, 0o775)}, "/home/dev"),
    "a root-owned cache root": ({_CACHE_ROOT: PathFact(False, _ROOT, _SHARED_GROUP, 0o700)}, _CACHE_ROOT),
    "a shared directory above the root": ({"/home/dev/.cache": _private(mode=0o1777)}, "/home/dev/.cache"),
    "an ancestor owned by another user": ({"/home": PathFact(False, _OTHER_USER, _SHARED_GROUP, 0o755)}, "/home"),
    "a missing ancestor": ({"/home/dev": None}, "/home/dev"),  # type: ignore[dict-item]
}


@pytest.mark.parametrize("name", list(_POSIX_CASES))
def test_applies_the_posix_rule_up_to_the_filesystem_root(name: str) -> None:
    changed, refused_path = _POSIX_CASES[name]
    facts = {
        _COPY: _private(),
        _HASH_DIRECTORY: _private(),
        _CACHE_ROOT: _private(),
        "/home/dev/.cache/composer": _private(mode=0o755),
        "/home/dev/.cache": _private(),
        "/home/dev": _private(mode=0o750),
        "/home": PathFact(False, _ROOT, _SHARED_GROUP, 0o755),
        "/": PathFact(False, _ROOT, _SHARED_GROUP, 0o755),
        **changed,
    }
    facts = {path: fact for path, fact in facts.items() if fact is not None}
    safety = PosixCacheSafety(_FakePosixFacts(facts))

    _assert_refusal(lambda: safety.refuse_unsafe(_COPY, _CACHE_ROOT), refused_path)


_USER_SID = "S-1-5-21-1-2-3-1001"
_OTHER_SID = "S-1-5-21-1-2-3-1002"
_EVERYONE_SID = "S-1-1-0"
_PROFILE = "C:\\Users\\dev"
_WINDOWS_CACHE_ROOT = "C:\\Users\\dev\\AppData\\Local\\seampact"
_WINDOWS_COPY = "C:\\Users\\dev\\AppData\\Local\\seampact\\abc\\seampact.exe"


class _FakeWindowsFacts:
    def __init__(self, facts: dict[str, WindowsPathFact]) -> None:
        self._facts = facts

    def of(self, paths: list[str]) -> dict[str, WindowsPathFact]:
        return {path: self._facts[path] for path in paths if path in self._facts}

    def current_user_sid(self) -> str:
        return _USER_SID


_WINDOWS_CASES: dict[str, tuple[dict[str, WindowsPathFact], str | None]] = {
    "a private cache under the profile": ({}, None),
    "a copy others may write": ({_WINDOWS_COPY: WindowsPathFact(False, (_USER_SID, _EVERYONE_SID))}, _WINDOWS_COPY),
    "a junction on the way": ({_WINDOWS_CACHE_ROOT: WindowsPathFact(True, (_USER_SID,))}, _WINDOWS_CACHE_ROOT),
    "a profile another user may write": ({_PROFILE: WindowsPathFact(False, (_USER_SID, _OTHER_SID))}, _PROFILE),
}


@pytest.mark.parametrize("name", list(_WINDOWS_CASES))
def test_applies_the_windows_rule_up_to_the_user_profile(name: str) -> None:
    changed, refused_path = _WINDOWS_CASES[name]
    private = WindowsPathFact(False, (_USER_SID, "S-1-5-18", "S-1-5-32-544"))
    paths = [
        _WINDOWS_COPY,
        "C:\\Users\\dev\\AppData\\Local\\seampact\\abc",
        _WINDOWS_CACHE_ROOT,
        "C:\\Users\\dev\\AppData\\Local",
        "C:\\Users\\dev\\AppData",
        _PROFILE,
    ]
    facts = {**{path: private for path in paths}, **changed}
    safety = WindowsCacheSafety(_PROFILE, _FakeWindowsFacts(facts))

    _assert_refusal(lambda: safety.refuse_unsafe(_WINDOWS_COPY, _WINDOWS_CACHE_ROOT), refused_path)


def test_refuses_a_windows_copy_outside_the_profile() -> None:
    safety = WindowsCacheSafety(_PROFILE, _FakeWindowsFacts({}))

    _assert_refusal(lambda: safety.refuse_unsafe("D:\\shared\\seampact.exe", "D:\\shared"), "D:\\shared\\seampact.exe")


def test_reads_the_facts_of_a_powershell_output() -> None:
    read: dict[str, object] = {"facts": [{"path": "C:\\a", "reparse": False, "writers": ["S-1-5-18"]}]}

    assert facts_of_output(read) == {"C:\\a": WindowsPathFact(False, ("S-1-5-18",))}


@pytest.mark.parametrize(
    "read",
    [
        {},
        {"facts": "C:\\a"},
        {"facts": [{"path": "C:\\a", "reparse": "no", "writers": []}]},
        {"facts": [{"path": "C:\\a", "reparse": False}]},
        {"facts": [{"path": "C:\\a", "reparse": False, "writers": [1]}]},
    ],
)
def test_refuses_a_powershell_output_of_another_shape(read: dict[str, object]) -> None:
    with pytest.raises(BinaryRefusedError) as refused:
        facts_of_output(read)

    assert refused.value.failure.code is BinaryFailureCode.CACHE_UNSAFE


def _assert_refusal(action, refused_path: str | None) -> None:  # type: ignore[no-untyped-def]
    if refused_path is None:
        action()

        return

    with pytest.raises(BinaryRefusedError) as refused:
        action()

    assert refused.value.failure.code is BinaryFailureCode.CACHE_UNSAFE
    assert f"'{refused_path}'" in refused.value.failure.message
